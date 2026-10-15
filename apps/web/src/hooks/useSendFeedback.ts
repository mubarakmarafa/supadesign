import { buildFeedbackPrompt } from "@supaterm/client-runtime/feedback-prompt";
import { useParams } from "@tanstack/react-router";

import { APP_VERSION } from "../branding";
import { useComposerDraftStore } from "../composerDraftStore";
import { isElectron } from "../env";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { useScratchProject } from "./useScratchProject";

export function useSendFeedback() {
  const target = resolveThreadRouteTarget(useParams({ strict: false }));
  const draftEnvironmentId = useComposerDraftStore((store) =>
    target?.kind === "draft"
      ? (store.getDraftSession(target.draftId)?.environmentId ?? null)
      : null,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { environments } = useEnvironments();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const environmentId = scratchEnvironmentId(
    (target?.kind === "server" ? target.threadRef.environmentId : draftEnvironmentId) ??
      primaryEnvironmentId,
  );
  const serverVersion = environments.find((entry) => entry.environmentId === environmentId)
    ?.serverConfig?.environment.serverVersion;
  if (environmentId === null || serverVersion === undefined) return null;
  return () =>
    startScratchThread(
      environmentId,
      buildFeedbackPrompt({
        serverVersion,
        client: `${isElectron ? "desktop" : "web"} app ${APP_VERSION}`,
      }),
    );
}
