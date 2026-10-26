import { afterEach, describe, expect, it } from "vite-plus/test";

import { toggleThemeEditorForTheme, useThemeEditorStore } from "./themeEditorStore";

afterEach(() => {
  useThemeEditorStore.getState().closeThemeEditor();
});

describe("toggleThemeEditorForTheme", () => {
  it("opens a new editor seeded from the theme active for the current appearance", () => {
    toggleThemeEditorForTheme({
      theme: "catppuccin-latte",
      themeHalves: { dark: "dracula" },
      initialAppearance: "dark",
    });

    expect(useThemeEditorStore.getState().session).toMatchObject({
      editingThemeId: null,
      seedThemeId: "dracula",
      seedName: null,
      initialAppearance: "dark",
    });
  });

  it("closes an open editor", () => {
    toggleThemeEditorForTheme({
      theme: "catppuccin-latte",
      themeHalves: null,
      initialAppearance: "light",
    });
    toggleThemeEditorForTheme({
      theme: "catppuccin-latte",
      themeHalves: null,
      initialAppearance: "light",
    });

    expect(useThemeEditorStore.getState().session).toBeNull();
  });
});
