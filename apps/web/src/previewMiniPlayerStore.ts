import { scopedThreadKey } from "@supaterm/client-runtime/environment";
import type { DevicePlatform, ScopedThreadRef } from "@supaterm/contracts";
import { create } from "zustand";

export interface PreviewMiniPlayerPosition {
  readonly x: number;
  readonly y: number;
}

export interface PreviewMiniPlayerSize {
  readonly width: number;
  readonly height: number;
}

/** What the floating player mirrors: a browser tab or a device stream. */
export type PreviewMiniPlayerSource =
  | { readonly kind: "browser"; readonly tabId: string }
  | {
      readonly kind: "device";
      readonly hostId: string;
      readonly deviceId: string;
      readonly platform: DevicePlatform;
      readonly name: string;
    };

export interface PreviewMiniPlayerState {
  readonly source: PreviewMiniPlayerSource;
  readonly position: PreviewMiniPlayerPosition | null;
  readonly width: number | null;
  /**
   * A browser player sizes like a window, so it keeps its own height. A device
   * player ignores this: its height follows the screen's aspect ratio.
   */
  readonly height: number | null;
  readonly lastInteraction: "drag" | "resize";
}

interface PreviewMiniPlayerStoreState {
  readonly byThreadKey: Record<string, PreviewMiniPlayerState>;
  readonly open: (ref: ScopedThreadRef, source: PreviewMiniPlayerSource) => void;
  readonly close: (ref: ScopedThreadRef) => void;
  /** `sourceKey` guards against a drag that outlives the source it started on. */
  readonly move: (
    ref: ScopedThreadRef,
    sourceKey: string,
    position: PreviewMiniPlayerPosition,
  ) => void;
  readonly resize: (
    ref: ScopedThreadRef,
    sourceKey: string,
    size: PreviewMiniPlayerSize,
    position?: PreviewMiniPlayerPosition,
  ) => void;
  /** Keeps the size a new player first appeared at, so its shape stops following the page. */
  readonly settle: (ref: ScopedThreadRef, sourceKey: string, size: PreviewMiniPlayerSize) => void;
  readonly removeThread: (ref: ScopedThreadRef) => void;
}

export function previewMiniPlayerSourceKey(source: PreviewMiniPlayerSource): string {
  return source.kind === "browser"
    ? `browser:${source.tabId}`
    : `device:${encodeURIComponent(source.hostId)}:${encodeURIComponent(source.deviceId)}`;
}

export const browserMiniPlayerSource = (tabId: string): PreviewMiniPlayerSource => ({
  kind: "browser",
  tabId,
});

export const usePreviewMiniPlayerStore = create<PreviewMiniPlayerStoreState>()((set) => ({
  byThreadKey: {},
  open: (ref, source) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (
        current &&
        previewMiniPlayerSourceKey(current.source) === previewMiniPlayerSourceKey(source)
      ) {
        return state;
      }
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: {
            source,
            position: current?.position ?? null,
            width: current?.width ?? null,
            height: current?.height ?? null,
            lastInteraction: current?.lastInteraction ?? "drag",
          },
        },
      };
    }),
  close: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _closed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
  move: (ref, sourceKey, position) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (!current || previewMiniPlayerSourceKey(current.source) !== sourceKey) return state;
      if (
        current.position?.x === position.x &&
        current.position.y === position.y &&
        current.lastInteraction === "drag"
      )
        return state;
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: { ...current, position, lastInteraction: "drag" },
        },
      };
    }),
  resize: (ref, sourceKey, { width, height }, position) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (
        !current ||
        previewMiniPlayerSourceKey(current.source) !== sourceKey ||
        (current.width === width &&
          current.height === height &&
          current.lastInteraction === "resize" &&
          (!position || (current.position?.x === position.x && current.position.y === position.y)))
      ) {
        return state;
      }
      return {
        byThreadKey: {
          ...state.byThreadKey,
          [threadKey]: {
            ...current,
            width,
            height,
            position: position ?? current.position,
            lastInteraction: "resize",
          },
        },
      };
    }),
  settle: (ref, sourceKey, { width, height }) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      const current = state.byThreadKey[threadKey];
      if (
        !current ||
        previewMiniPlayerSourceKey(current.source) !== sourceKey ||
        (current.width !== null && current.height !== null)
      ) {
        return state;
      }
      return {
        byThreadKey: { ...state.byThreadKey, [threadKey]: { ...current, width, height } },
      };
    }),
  removeThread: (ref) =>
    set((state) => {
      const threadKey = scopedThreadKey(ref);
      if (!(threadKey in state.byThreadKey)) return state;
      const { [threadKey]: _removed, ...byThreadKey } = state.byThreadKey;
      return { byThreadKey };
    }),
}));

export function selectThreadPreviewMiniPlayer(
  byThreadKey: Record<string, PreviewMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): PreviewMiniPlayerState | null {
  if (!ref) return null;
  return byThreadKey[scopedThreadKey(ref)] ?? null;
}

/** The floating browser tab, or null when nothing floats or a device does. */
export function selectThreadPreviewMiniPlayerTabId(
  byThreadKey: Record<string, PreviewMiniPlayerState>,
  ref: ScopedThreadRef | null | undefined,
): string | null {
  const source = selectThreadPreviewMiniPlayer(byThreadKey, ref)?.source;
  return source?.kind === "browser" ? source.tabId : null;
}
