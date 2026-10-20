import {
  THREAD_BANK_MAX_ENTRIES,
  ThreadBankEntryId,
  ThreadBankError,
  combineThreadBankEntries,
  type ChatAttachment,
  type ModelSelection,
  type OrchestrationMessageContext,
  type ProjectId,
  type ThreadBank,
  type ThreadBankAddInput,
  type ThreadBankEntry,
  type ThreadBankEntryInput,
  type ThreadBankList,
  type ThreadBankReorderInput,
  type ThreadBankUpdateInput,
  type ThreadId,
} from "@supaterm/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";

/** Where a bank's material lives and how a sent bank reaches the agent. */
export interface ThreadBankOps {
  readonly projectOf: (threadId: ThreadId) => Effect.Effect<ProjectId, ThreadBankError>;
  /** Moves pending uploads into the thread so they outlive the upload sweep. */
  readonly claim: (input: {
    readonly threadId: ThreadId;
    readonly attachments: ReadonlyArray<ChatAttachment>;
    readonly context: OrchestrationMessageContext | undefined;
  }) => Effect.Effect<
    {
      readonly attachments: ReadonlyArray<ChatAttachment>;
      readonly context: OrchestrationMessageContext | undefined;
    },
    ThreadBankError
  >;
  /** Delivers one message, queued behind any running turn. */
  readonly send: (input: {
    readonly threadId: ThreadId;
    readonly text: string;
    readonly attachments: ReadonlyArray<ChatAttachment>;
    readonly context: OrchestrationMessageContext | undefined;
    readonly modelSelection?: ModelSelection | undefined;
  }) => Effect.Effect<void, ThreadBankError>;
  readonly newEntryId: Effect.Effect<string>;
  readonly now: Effect.Effect<string>;
  readonly load: Effect.Effect<ReadonlyArray<StoredBank>>;
  readonly save: (banks: ReadonlyArray<StoredBank>) => Effect.Effect<void>;
}

export interface StoredBank extends ThreadBank {
  readonly projectId: ProjectId;
}

export class ThreadBankService extends Context.Service<
  ThreadBankService,
  {
    readonly add: (input: ThreadBankAddInput) => Effect.Effect<ThreadBankEntry, ThreadBankError>;
    readonly update: (input: ThreadBankUpdateInput) => Effect.Effect<void, ThreadBankError>;
    readonly remove: (input: ThreadBankEntryInput) => Effect.Effect<void, ThreadBankError>;
    readonly reorder: (input: ThreadBankReorderInput) => Effect.Effect<void, ThreadBankError>;
    /** Sends every entry as one message, then empties the bank. False when it was empty. */
    readonly send: (threadId: ThreadId) => Effect.Effect<boolean, ThreadBankError>;
    /**
     * Sends every entry as one message whose text is `render` of theirs, such
     * as a column's prompt around them, then empties the bank. False when empty.
     */
    readonly sendAs: (input: {
      readonly threadId: ThreadId;
      readonly render: (text: string) => string;
      readonly modelSelection?: ModelSelection | undefined;
    }) => Effect.Effect<boolean, ThreadBankError>;
    readonly get: (threadId: ThreadId) => Effect.Effect<ReadonlyArray<ThreadBankEntry>>;
    /** Calls `listener` with the project's non-empty banks now and after every change. */
    readonly subscribe: (
      projectId: ProjectId,
      listener: (list: ThreadBankList) => Effect.Effect<void>,
    ) => Effect.Effect<() => void>;
  }
>()("supaterm/threadBank/ThreadBankService") {}

const fail = (message: string) => new ThreadBankError({ message });

const hasContent = (input: {
  readonly text: string;
  readonly attachments: ReadonlyArray<unknown>;
  readonly context?: OrchestrationMessageContext | undefined;
}) =>
  input.text.trim().length > 0 ||
  input.attachments.length > 0 ||
  (input.context?.records.length ?? 0) > 0;

export const make = (ops: ThreadBankOps) =>
  Effect.gen(function* () {
    const banks = new Map<ThreadId, StoredBank>();
    for (const bank of yield* ops.load) {
      if (bank.entries.length > 0) banks.set(bank.threadId, bank);
    }
    const listeners = new Set<{
      readonly projectId: ProjectId;
      readonly listener: (list: ThreadBankList) => Effect.Effect<void>;
    }>();
    const lock = yield* Semaphore.make(1);
    const locked = <A, E>(effect: Effect.Effect<A, E>) => lock.withPermits(1)(effect);

    const listFor = (projectId: ProjectId): ThreadBankList =>
      banks
        .values()
        .filter((bank) => bank.projectId === projectId)
        .map(({ threadId, entries }) => ({ threadId, entries }))
        .toArray();

    const commit = (projectId: ProjectId) =>
      Effect.gen(function* () {
        yield* ops.save(banks.values().toArray());
        yield* Effect.forEach(
          listeners,
          (subscription) =>
            subscription.projectId === projectId
              ? subscription.listener(listFor(projectId))
              : Effect.void,
          { discard: true },
        );
      });

    const setEntries = (bank: StoredBank, entries: ReadonlyArray<ThreadBankEntry>) => {
      if (entries.length === 0) banks.delete(bank.threadId);
      else banks.set(bank.threadId, { ...bank, entries });
      return commit(bank.projectId);
    };

    const requireBank = (threadId: ThreadId) => {
      const bank = banks.get(threadId);
      return bank === undefined
        ? Effect.fail(fail("This card has nothing banked."))
        : Effect.succeed(bank);
    };

    const requireEntry = (bank: StoredBank, entryId: string) => {
      const index = bank.entries.findIndex((entry) => entry.id === entryId);
      return index === -1
        ? Effect.fail(fail("That banked message no longer exists."))
        : Effect.succeed(index);
    };

    const add: ThreadBankService["Service"]["add"] = (input) =>
      Effect.gen(function* () {
        if (!hasContent(input)) return yield* fail("There's nothing to bank.");
        const projectId = yield* ops.projectOf(input.threadId);
        const claimed = yield* ops.claim({
          threadId: input.threadId,
          attachments: input.attachments,
          context: input.context,
        });
        const entry: ThreadBankEntry = {
          id: ThreadBankEntryId.make(yield* ops.newEntryId),
          text: input.text,
          ...(claimed.context === undefined ? {} : { context: claimed.context }),
          attachments: claimed.attachments,
          createdAt: yield* ops.now,
        };
        return yield* locked(
          Effect.gen(function* () {
            const bank = banks.get(input.threadId) ?? {
              threadId: input.threadId,
              projectId,
              entries: [],
            };
            if (bank.entries.length >= THREAD_BANK_MAX_ENTRIES) {
              return yield* fail(
                `A card can bank up to ${THREAD_BANK_MAX_ENTRIES} messages. Send or remove some first.`,
              );
            }
            yield* setEntries(bank, [...bank.entries, entry]);
            return entry;
          }),
        );
      });

    const update: ThreadBankService["Service"]["update"] = (input) =>
      Effect.gen(function* () {
        const claimed = yield* ops.claim({
          threadId: input.threadId,
          attachments: input.attachments,
          context: input.context,
        });
        yield* locked(
          Effect.gen(function* () {
            const bank = yield* requireBank(input.threadId);
            const index = yield* requireEntry(bank, input.entryId);
            const current = bank.entries[index]!;
            const next: ThreadBankEntry = {
              id: current.id,
              createdAt: current.createdAt,
              text: input.text,
              ...(claimed.context === undefined ? {} : { context: claimed.context }),
              attachments: claimed.attachments,
            };
            const entries = hasContent(next)
              ? bank.entries.with(index, next)
              : bank.entries.toSpliced(index, 1);
            yield* setEntries(bank, entries);
          }),
        );
      });

    const remove: ThreadBankService["Service"]["remove"] = (input) =>
      locked(
        Effect.gen(function* () {
          const bank = yield* requireBank(input.threadId);
          const index = yield* requireEntry(bank, input.entryId);
          yield* setEntries(bank, bank.entries.toSpliced(index, 1));
        }),
      );

    const reorder: ThreadBankService["Service"]["reorder"] = (input) =>
      locked(
        Effect.gen(function* () {
          const bank = yield* requireBank(input.threadId);
          const index = yield* requireEntry(bank, input.entryId);
          const moved = bank.entries[index]!;
          const rest = bank.entries.toSpliced(index, 1);
          const before =
            input.beforeEntryId === null
              ? rest.length
              : rest.findIndex((entry) => entry.id === input.beforeEntryId);
          if (before === -1) return yield* fail("That banked message no longer exists.");
          yield* setEntries(bank, rest.toSpliced(before, 0, moved));
        }),
      );

    const sendAs: ThreadBankService["Service"]["sendAs"] = ({ threadId, render, modelSelection }) =>
      locked(
        Effect.gen(function* () {
          const bank = banks.get(threadId);
          if (bank === undefined) return false;
          const combined = combineThreadBankEntries(bank.entries);
          yield* ops.send({
            threadId,
            ...combined,
            text: render(combined.text),
            ...(modelSelection === undefined ? {} : { modelSelection }),
          });
          yield* setEntries(bank, []);
          return true;
        }),
      );

    const send: ThreadBankService["Service"]["send"] = (threadId) =>
      sendAs({ threadId, render: (text) => text });

    const get: ThreadBankService["Service"]["get"] = (threadId) =>
      Effect.sync(() => banks.get(threadId)?.entries ?? []);

    const subscribe: ThreadBankService["Service"]["subscribe"] = (projectId, listener) =>
      locked(
        Effect.gen(function* () {
          const subscription = { projectId, listener };
          listeners.add(subscription);
          yield* listener(listFor(projectId));
          return () => {
            listeners.delete(subscription);
          };
        }),
      );

    return ThreadBankService.of({ add, update, remove, reorder, send, sendAs, get, subscribe });
  });
