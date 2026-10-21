import type {
  AssetCreateUrlResult,
  AssetResource,
  EnvironmentId,
  PreviewOpenInput,
  PreviewSessionSnapshot,
  ScopedThreadRef,
} from "@supaterm/contracts";
import { mediaFileReference } from "@supaterm/client-runtime/media-reference";
import {
  type AtomCommandResult,
  mapAtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import { AsyncResult } from "effect/reactivity";

import { resolveAssetUrl } from "~/assets/assetUrls";
import { isPreviewAvailableFor, previewRuntimeFor } from "~/browser/previewRuntime";
import {
  applyPreviewServerSnapshot,
  readThreadPreviewState,
  rememberPreviewUrl,
  setActivePreviewTab,
  updatePreviewServerSnapshot,
} from "~/previewStateStore";
import { browserMiniPlayerSource, usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import {
  selectActiveRightPanelSurface,
  selectSelectedRightPanelSurface,
  useRightPanelStore,
} from "~/rightPanelStore";

import {
  browserDefaultOpenProfileId,
  browserDefaultOpenViewport,
  resolveBrowserDefaults,
} from "./browserDefaults";

export const isBrowserPreviewFile = (path: string): boolean =>
  /\.(?:html?|pdf)$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export class BrowserPreviewUnavailableError extends Data.TaggedError(
  "BrowserPreviewUnavailableError",
)<{
  readonly message: string;
}> {}

export class BrowserSettingsReadError extends Data.TaggedError("BrowserSettingsReadError")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return "Saved browser settings could not be loaded.";
  }
}

export type OpenPreviewMutation<E = unknown> = (input: {
  readonly environmentId: EnvironmentId;
  readonly input: PreviewOpenInput;
}) => Promise<AtomCommandResult<PreviewSessionSnapshot, E>>;

export async function openUrlInPreview<E>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly url: string;
  readonly assetRelativeUrl?: string;
  readonly openPreview: OpenPreviewMutation<E>;

  readonly profileId?: PreviewOpenInput["profileId"];

  readonly background?: boolean;
  /** Float the page over chat instead of docking it in the right panel. */
  readonly floating?: boolean;
}): Promise<AtomCommandResult<void, E | BrowserSettingsReadError>> {
  const defaults = await resolveBrowserDefaults().catch(
    (cause: unknown) => new BrowserSettingsReadError({ cause }),
  );
  if (defaults instanceof BrowserSettingsReadError) {
    return AsyncResult.failure(Cause.fail(defaults));
  }
  const runtime = previewRuntimeFor(input.threadRef.environmentId);
  const previousActiveTabId = readThreadPreviewState(input.threadRef).activeTabId;

  const selectedSurface = () =>
    selectSelectedRightPanelSurface(useRightPanelStore.getState().byThreadKey, input.threadRef)
      ?.id ?? null;
  const surfaceBeforeOpen = selectedSurface();
  const result = await input.openPreview({
    environmentId: input.threadRef.environmentId,
    input: {
      threadId: input.threadRef.threadId,
      url: input.url,
      ...(runtime === "server" && input.assetRelativeUrl !== undefined
        ? { assetRelativeUrl: input.assetRelativeUrl }
        : {}),
      // Built here rather than via `openPreviewSession` because this path
      // maps the result differently, so the configured defaults have to be
      // applied explicitly or file/link opens would ignore them.
      viewport: browserDefaultOpenViewport(defaults),
      profileId: input.profileId ?? browserDefaultOpenProfileId(defaults),
      ...(runtime === undefined ? {} : { runtime }),
    },
  });
  return mapAtomCommandResult(result, (snapshot) => {
    rememberPreviewUrl(input.threadRef, input.url);
    if (input.background) {
      updatePreviewServerSnapshot(input.threadRef, snapshot);

      if (
        previousActiveTabId &&
        readThreadPreviewState(input.threadRef).activeTabId === snapshot.tabId &&
        selectedSurface() === surfaceBeforeOpen
      ) {
        setActivePreviewTab(input.threadRef, previousActiveTabId);
      }
      return;
    }
    applyPreviewServerSnapshot(input.threadRef, snapshot);
    if (input.floating) floatPreviewTab(input.threadRef, snapshot.tabId);
    else useRightPanelStore.getState().openBrowser(input.threadRef, snapshot.tabId);
  });
}

/** Floats a thread's browser tab over chat, taking it out of the right panel if it's there. */
export function floatPreviewTab(threadRef: ScopedThreadRef, tabId: string): void {
  usePreviewMiniPlayerStore.getState().open(threadRef, browserMiniPlayerSource(tabId));
  const panel = useRightPanelStore.getState();
  const docked = selectActiveRightPanelSurface(panel.byThreadKey, threadRef);
  if (docked?.kind === "preview" && docked.resourceId === tabId) panel.close(threadRef);
}

/**
 * The thread's tab already showing a page from `url`'s server, wherever the
 * designer has navigated within it, so reopening a site returns to their place.
 * A tab that failed to load is left alone: it would float as nothing.
 */
export function findPreviewTabForOrigin(threadRef: ScopedThreadRef, url: string): string | null {
  const origin = originOf(url);
  if (origin === null) return null;
  const { sessions, activeTabId } = readThreadPreviewState(threadRef);
  const matches = Object.values(sessions).filter(
    ({ navStatus }) =>
      (navStatus._tag === "Success" || navStatus._tag === "Loading") &&
      originOf(navStatus.url) === origin,
  );
  return (matches.find((session) => session.tabId === activeTabId) ?? matches[0])?.tabId ?? null;
}

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * Opens a browser document in the integrated browser. Inside the workspace the
 * page may load sibling assets; a file outside it is served on its own.
 */
export async function openFileInPreview<AssetError, PreviewError>(input: {
  readonly threadRef: ScopedThreadRef;
  readonly filePath: string;
  readonly workspaceRoot: string | undefined;
  readonly httpBaseUrl: string;
  readonly createAssetUrl: (input: {
    readonly environmentId: EnvironmentId;
    readonly input: { readonly resource: AssetResource };
  }) => Promise<AtomCommandResult<AssetCreateUrlResult, AssetError>>;
  readonly openPreview: OpenPreviewMutation<PreviewError>;
}): Promise<
  AtomCommandResult<
    void,
    AssetError | PreviewError | BrowserPreviewUnavailableError | BrowserSettingsReadError
  >
> {
  if (!isPreviewAvailableFor(input.threadRef.environmentId)) {
    return AsyncResult.failure(
      Cause.fail(
        new BrowserPreviewUnavailableError({
          message: "The integrated browser is unavailable in this runtime.",
        }),
      ),
    );
  }
  const insideWorkspace =
    mediaFileReference(input.filePath, input.workspaceRoot).relativePath !== undefined;
  const assetResult = await input.createAssetUrl({
    environmentId: input.threadRef.environmentId,
    input: {
      resource: {
        _tag: insideWorkspace ? "workspace-file" : "media-file",
        threadId: input.threadRef.threadId,
        path: input.filePath,
      },
    },
  });
  if (assetResult._tag === "Failure") {
    return AsyncResult.failure(assetResult.cause);
  }
  const assetUrl = resolveAssetUrl(input.httpBaseUrl, assetResult.value.relativeUrl);
  if (assetUrl === null) {
    return AsyncResult.failure(
      Cause.die(new Error("The environment returned an invalid asset URL.")),
    );
  }
  return openUrlInPreview({
    threadRef: input.threadRef,
    url: assetUrl,
    assetRelativeUrl: assetResult.value.relativeUrl,
    openPreview: input.openPreview,
  });
}
