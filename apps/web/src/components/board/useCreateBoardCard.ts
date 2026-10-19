import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { DEFAULT_PROVIDER_INTERACTION_MODE, type ThreadId } from "@supaterm/contracts";
import { resolveProjectSettings } from "@supaterm/shared/projectSettings";
import { useCallback } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { newThreadId } from "../../lib/utils";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { threadEnvironment } from "../../state/threads";
import { useOrchestrationCommand } from "../../state/use-orchestration-command";
import { DEFAULT_RUNTIME_MODE } from "../../types";
import { scheduledTaskDefaultModel } from "../automations/automations.logic";

export type CreateBoardCardResult =
  | { readonly _tag: "created"; readonly threadId: ThreadId }
  | { readonly _tag: "no-model" }
  | { readonly _tag: "failed"; readonly message: string | null };

/**
 * Makes a card's thread without starting it: the project's default model and
 * permissions, no worktree yet, nothing sent. What was typed waits in the
 * thread's composer on this device, so opening the card is one Enter from
 * starting it.
 */
export function useCreateBoardCard(project: EnvironmentProject) {
  const environmentId = project.environmentId;
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const createThread = useOrchestrationCommand(threadEnvironment.create);

  return useCallback(
    async (input: { title: string; draft: string }): Promise<CreateBoardCardResult> => {
      const entries = sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(providers),
          settings,
          project.id,
        ),
      );
      const modelSelection = scheduledTaskDefaultModel(settings, project, entries);
      if (modelSelection === null) return { _tag: "no-model" };
      const runtimeMode =
        resolveProjectSettings(settings, project.id, project).settings.defaultRuntimeMode ??
        DEFAULT_RUNTIME_MODE;
      const threadId = newThreadId();
      const result = await createThread({
        environmentId,
        input: {
          threadId,
          projectId: project.id,
          title: input.title,
          modelSelection,
          runtimeMode,
          interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
          branch: null,
          worktreePath: null,
        },
      });
      if (result._tag === "Failure") {
        // An interrupted command was cancelled on purpose and needs no message.
        if (isAtomCommandInterrupted(result)) return { _tag: "failed", message: null };
        const error = squashAtomCommandFailure(result);
        return {
          _tag: "failed",
          message: error instanceof Error ? error.message : "An error occurred.",
        };
      }
      useComposerDraftStore
        .getState()
        .setPrompt(scopeThreadRef(environmentId, threadId), input.draft);
      return { _tag: "created", threadId };
    },
    [createThread, environmentId, project, providers, settings],
  );
}
