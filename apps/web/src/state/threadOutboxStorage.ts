import type { BrowserThreadOutboxStorage } from "./threadOutboxDelivery";
import * as Schema from "effect/Schema";

import { OutboxTurn, StoredOutboxEntry, encodeStoredOutboxEntry } from "./threadOutboxSchema";
import { randomUUID } from "../lib/utils";

const DATABASE_NAME = "supaterm-thread-outbox";
const LEASE_MS = 60_000;
const decode = Schema.decodeUnknownSync(StoredOutboxEntry);
let database: Promise<IDBDatabase> | null = null;
let channel: BroadcastChannel | null = null;
function storageChannel() {
  if (typeof BroadcastChannel !== "undefined") channel ??= new BroadcastChannel(DATABASE_NAME);
  return channel;
}

export function subscribeThreadOutboxStorage(listener: () => void) {
  const source = storageChannel();
  source?.addEventListener("message", listener);
  return () => source?.removeEventListener("message", listener);
}

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("messages", { keyPath: "id" });
      request.result.createObjectStore("locks", { keyPath: "scope" });
    };
    request.onsuccess = () => {
      request.result.addEventListener("versionchange", () => {
        request.result.close();
        database = null;
      });
      resolve(request.result);
    };
    request.addEventListener("error", () => {
      database = null;
      reject(request.error);
    });
    request.onblocked = () => {
      database = null;
      reject(new Error("Close other Supaterm tabs to open message storage."));
    };
  });
  return database;
}

async function transaction<A>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore, complete: (result: A) => void) => void,
): Promise<A> {
  const db = await openDatabase();
  return new Promise<A>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    let result: A;
    tx.oncomplete = () => resolve(result);
    tx.addEventListener("error", () => reject(tx.error));
    tx.addEventListener("abort", () =>
      reject(tx.error ?? new Error("Message storage transaction was aborted.")),
    );
    operation(tx.objectStore(storeName), (value) => {
      result = value;
    });
  });
}

const Lease = Schema.Struct({
  scope: Schema.String,
  owner: Schema.String,
  expiresAt: Schema.Number,
});
const decodeLease = Schema.decodeUnknownSync(Lease);

/** IndexedDB also works on HTTP LAN origins where Web Locks are unavailable. */
export const browserThreadOutboxStorage: BrowserThreadOutboxStorage<OutboxTurn> = {
  load: async () => {
    const values = await transaction<unknown[]>("messages", "readonly", (store, complete) => {
      const request = store.getAll();
      request.onsuccess = () => complete(request.result);
    });
    return values.map((value) => {
      const { schemaVersion: _, ...entry } = decode(value);
      return entry;
    });
  },
  write: async (entry) => {
    const changed = await transaction<boolean>("messages", "readwrite", (store, complete) => {
      const request = store.getKey(entry.id);
      request.onsuccess = () => {
        if (request.result === undefined) {
          complete(false);
          return;
        }
        store.put(encodeStoredOutboxEntry(entry));
        complete(true);
      };
    });
    if (changed) storageChannel()?.postMessage("changed");
    return changed;
  },
  writeMany: async (entries) => {
    await transaction<void>("messages", "readwrite", (store, complete) => {
      for (const entry of entries) store.add(encodeStoredOutboxEntry(entry));
      complete(undefined);
    });
    storageChannel()?.postMessage("changed");
  },
  remove: async (id) => {
    await transaction<void>("messages", "readwrite", (store, complete) => {
      store.delete(id);
      complete(undefined);
    });
    storageChannel()?.postMessage("changed");
  },
  withLock: async (scope, action) => {
    const owner = randomUUID();
    const claimed = await transaction<boolean>("locks", "readwrite", (store, complete) => {
      const request = store.get(scope);
      request.onsuccess = () => {
        const existing = request.result === undefined ? null : decodeLease(request.result);
        if (existing !== null && existing.expiresAt > Date.now()) {
          complete(false);
          return;
        }
        store.put({ scope, owner, expiresAt: Date.now() + LEASE_MS });
        complete(true);
      };
    });
    if (!claimed) return null;
    const renew = () =>
      transaction<void>("locks", "readwrite", (store, complete) => {
        const request = store.get(scope);
        request.onsuccess = () => {
          if (request.result !== undefined && decodeLease(request.result).owner === owner) {
            store.put({ scope, owner, expiresAt: Date.now() + LEASE_MS });
          }
          complete(undefined);
        };
      });
    const timer = setInterval(() => {
      void renew().catch(console.error);
    }, LEASE_MS / 3);
    try {
      return await action();
    } finally {
      clearInterval(timer);
      await transaction<void>("locks", "readwrite", (store, complete) => {
        const request = store.get(scope);
        request.onsuccess = () => {
          if (request.result !== undefined && decodeLease(request.result).owner === owner)
            store.delete(scope);
          complete(undefined);
        };
      });
    }
  },
};
