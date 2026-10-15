import { EnvironmentId } from "@supaterm/contracts";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => {
  const values = new Map<string, string>();
  let preferencesJson: string | null = null;
  let preferencesUpdatedAt = 0;
  let loadPreferencesFails = false;
  let savePreferencesFails = false;
  return {
    clear: () => {
      values.clear();
      preferencesJson = null;
      preferencesUpdatedAt = 0;
      loadPreferencesFails = false;
      savePreferencesFails = false;
    },
    getStoredValue: (key: string) => values.get(key) ?? null,
    getPreferencesJson: () => preferencesJson,
    setPreferencesJson: (value: string, updatedAt: number) => {
      preferencesJson = value;
      preferencesUpdatedAt = updatedAt;
    },
    setDatabaseFailures: (load: boolean, save: boolean) => {
      loadPreferencesFails = load;
      savePreferencesFails = save;
    },
    getItemAsync: vi.fn((key: string) => Promise.resolve(values.get(key) ?? null)),
    setItemAsync: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: vi.fn((key: string) => {
      values.delete(key);
      return Promise.resolve();
    }),
    database: {
      closeAsync: vi.fn(() => Promise.resolve()),
      execAsync: vi.fn(() => Promise.resolve()),
      withExclusiveTransactionAsync: vi.fn(
        (run: (transaction: { execAsync: () => Promise<void> }) => Promise<void>) =>
          run({ execAsync: () => Promise.resolve() }),
      ),
      getFirstAsync: vi.fn((sql: string) => {
        if (sql.includes("PRAGMA user_version")) {
          return Promise.resolve({ user_version: 1 });
        }
        if (loadPreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        return Promise.resolve(
          preferencesJson === null
            ? null
            : { payload: preferencesJson, updatedAt: preferencesUpdatedAt },
        );
      }),
      runAsync: vi.fn((_sql: string, payload?: unknown, updatedAt?: unknown) => {
        if (savePreferencesFails) {
          return Promise.reject(new Error("database unavailable"));
        }
        if (typeof payload === "string") {
          preferencesJson = payload;
        }
        if (typeof updatedAt === "number") {
          preferencesUpdatedAt = updatedAt;
        }
        return Promise.resolve();
      }),
    },
  };
});

vi.mock("expo-secure-store", () => ({
  deleteItemAsync: mocks.deleteItemAsync,
  getItemAsync: mocks.getItemAsync,
  setItemAsync: mocks.setItemAsync,
}));

vi.mock("expo-sqlite", () => ({
  openDatabaseAsync: vi.fn(() => Promise.resolve(mocks.database)),
}));

vi.mock("expo-crypto", () => ({
  getRandomBytes: vi.fn(() => new Uint8Array(16)),
}));

vi.mock("expo-constants", () => ({
  default: { expoConfig: { extra: {} } },
}));

vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
  },
}));

import {
  loadPreferences,
  loadSavedConnections,
  saveConnection,
  savePreferencesPatch,
} from "../persistence/imperative";

const bearerConnection = {
  environmentId: EnvironmentId.make("environment-1"),
  environmentLabel: "Desktop",
  pairingUrl: "https://desktop.example/",
  displayUrl: "https://desktop.example/",
  httpBaseUrl: "https://desktop.example/",
  wsBaseUrl: "wss://desktop.example/",
  bearerToken: "bearer-token",
} as const;

describe("mobile connection storage", () => {
  beforeEach(() => {
    mocks.clear();
    vi.clearAllMocks();
  });

  it("round-trips bearer connections", async () => {
    await saveConnection(bearerConnection);

    await expect(loadSavedConnections()).resolves.toEqual([bearerConnection]);
  });

  it("skips stored connections that have no bearer token", async () => {
    await mocks.setItemAsync(
      "supaterm.connections",
      JSON.stringify({
        connections: [
          { ...bearerConnection, environmentId: "environment-2", bearerToken: null },
          bearerConnection,
        ],
      }),
    );

    await expect(loadSavedConnections()).resolves.toEqual([bearerConnection]);
  });

  it("preserves secure-storage read failures with operation and key context", async () => {
    const cause = new Error("keychain unavailable");
    mocks.getItemAsync.mockRejectedValueOnce(cause);

    await expect(loadSavedConnections()).rejects.toMatchObject({
      _tag: "MobileSecureStorageError",
      operation: "read",
      key: "supaterm.connections",
      cause,
      message: "Mobile secure storage operation read failed for key supaterm.connections.",
    });
  });

  it("logs structured decode failures before using the empty fallback", async () => {
    await mocks.setItemAsync("supaterm.connections", "{");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadSavedConnections()).resolves.toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "[mobile-storage] ignored invalid JSON",
      expect.objectContaining({
        _tag: "MobileStorageDecodeError",
        key: "supaterm.connections",
        cause: expect.any(SyntaxError),
        message: "Failed to decode mobile storage value for key supaterm.connections.",
      }),
    );

    warn.mockRestore();
  });

  it("loads legacy preferences when SQLite is unavailable", async () => {
    mocks.setDatabaseFailures(true, true);
    await mocks.setItemAsync("supaterm.preferences", JSON.stringify({ baseFontSize: 17 }));

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 17 });
  });

  it("persists independent light and dark theme choices", async () => {
    mocks.setPreferencesJson(
      JSON.stringify({
        themeId: "grove",
        lightThemeId: "iris",
        darkThemeId: "ocean",
        themeMode: "system",
      }),
      10,
    );

    await expect(loadPreferences()).resolves.toEqual({
      themeId: "grove",
      lightThemeId: "iris",
      darkThemeId: "ocean",
      themeMode: "system",
    });
  });

  it("persists Material You independently for each appearance", async () => {
    const themes = { lightThemeId: "material-you", darkThemeId: "ocean" } as const;
    await savePreferencesPatch(themes);
    await expect(loadPreferences()).resolves.toEqual(themes);
    await savePreferencesPatch({ lightThemeId: "supaterm-chat" });
    await expect(loadPreferences()).resolves.toEqual({ ...themes, lightThemeId: "supaterm-chat" });
  });

  it.each([true, false])("drops the removed Android layout preference (%s)", async (enabled) => {
    mocks.setPreferencesJson(
      JSON.stringify({
        materialYouStyleLayoutEnabled: enabled,
        lightThemeId: "supaterm-chat",
      }),
      10,
    );
    await expect(loadPreferences()).resolves.toEqual({ lightThemeId: "supaterm-chat" });
  });

  it("drops the removed theme transition preference", async () => {
    mocks.setPreferencesJson(JSON.stringify({ themeTransition: "circle-bottom-left" }), 10);

    await expect(loadPreferences()).resolves.toEqual({});
  });

  it("falls back to secure storage when SQLite cannot save preferences", async () => {
    mocks.setDatabaseFailures(true, true);
    await expect(savePreferencesPatch({ baseFontSize: 19 })).resolves.toEqual({ baseFontSize: 19 });
    const fallback = JSON.parse(mocks.getStoredValue("supaterm.preferences.fallback") ?? "") as {
      readonly payload: string;
      readonly updatedAt: number;
    };
    expect(JSON.parse(fallback.payload)).toEqual({ baseFontSize: 19 });
    expect(fallback.updatedAt).toEqual(expect.any(Number));
  });

  it("persists thread list shelf preferences", async () => {
    await expect(
      savePreferencesPatch({
        threadListSettledShelfExpanded: false,
        threadListSnoozedShelfExpanded: true,
        threadListWorkingShelfExpanded: true,
      }),
    ).resolves.toEqual({
      threadListSettledShelfExpanded: false,
      threadListSnoozedShelfExpanded: true,
      threadListWorkingShelfExpanded: true,
    });

    await expect(loadPreferences()).resolves.toEqual({
      threadListSettledShelfExpanded: false,
      threadListSnoozedShelfExpanded: true,
      threadListWorkingShelfExpanded: true,
    });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({
      threadListSettledShelfExpanded: false,
      threadListSnoozedShelfExpanded: true,
      threadListWorkingShelfExpanded: true,
    });
  });

  it("drops legacy and invalid thread list shelf expansion preferences", async () => {
    mocks.setPreferencesJson(
      JSON.stringify({
        baseFontSize: 17,
        threadListV2SettledShelfExpanded: true,
        threadListV2SnoozedShelfExpanded: true,
        threadListSettledShelfExpanded: "false",
        threadListSnoozedShelfExpanded: 1,
      }),
      10,
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 17 });
  });

  it("keeps valid list filters and drops malformed ones", async () => {
    const threadListFilters = { environmentId: "environment-1", projectKey: null };
    const pullRequestListFilters = {
      environmentId: null,
      controls: {
        "": {
          state: "all",
          involvement: "reviewing",
          filters: { labels: [["size:S"]] },
          sort: "oldest",
        },
      },
    };
    mocks.setPreferencesJson(JSON.stringify({ threadListFilters, pullRequestListFilters }), 10);
    await expect(loadPreferences()).resolves.toEqual({ threadListFilters, pullRequestListFilters });

    mocks.setPreferencesJson(
      JSON.stringify({
        threadListFilters: { environmentId: 1, projectKey: null },
        pullRequestListFilters: { environmentId: null, controls: { "": { sort: "newest" } } },
      }),
      11,
    );
    await expect(loadPreferences()).resolves.toEqual({});
  });

  it("reconciles fallback preferences after SQLite recovers", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 15 }), 10);
    await mocks.setItemAsync(
      "supaterm.preferences.fallback",
      JSON.stringify({
        payload: JSON.stringify({ baseFontSize: 19 }),
        updatedAt: 20,
      }),
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 19 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 19 });
    expect(mocks.getStoredValue("supaterm.preferences.fallback")).toBeNull();
  });

  it("ignores a stale fallback when its previous deletion failed", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 21 }), 30);
    await mocks.setItemAsync(
      "supaterm.preferences.fallback",
      JSON.stringify({
        payload: JSON.stringify({ baseFontSize: 19 }),
        updatedAt: 20,
      }),
    );

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 21 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 21 });
    expect(mocks.getStoredValue("supaterm.preferences.fallback")).toBeNull();
  });

  it("ignores an invalid fallback even when it has a newer timestamp", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 21 }), 30);
    await mocks.setItemAsync(
      "supaterm.preferences.fallback",
      JSON.stringify({ payload: "{", updatedAt: 40 }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 21 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 21 });
    expect(mocks.getStoredValue("supaterm.preferences.fallback")).toBeNull();

    warn.mockRestore();
  });

  it("keeps SQLite authoritative when stale legacy preferences remain", async () => {
    mocks.setPreferencesJson(JSON.stringify({ baseFontSize: 21 }), 30);
    await mocks.setItemAsync("supaterm.preferences", JSON.stringify({ baseFontSize: 19 }));

    await expect(loadPreferences()).resolves.toEqual({ baseFontSize: 21 });
    expect(JSON.parse(mocks.getPreferencesJson() ?? "")).toEqual({ baseFontSize: 21 });
  });
});
