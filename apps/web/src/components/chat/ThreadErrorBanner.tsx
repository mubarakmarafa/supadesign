import type { OrchestrationV2ProviderFailureClass } from "@supaterm/contracts";
import { memo, useMemo } from "react";
import { usePresence } from "~/hooks/usePresence";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";

export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

// Session-scoped (module-level so it survives ChatView remounts, e.g. route
// changes between threads). Mirrors the branch-mismatch banner: a dismissal
// is remembered per thread key plus message, so navigating away to a thread
// with no error cannot resurrect the banner, while a different error message
// on the same thread still appears.
const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
  errorClass,
  chatGptUsageLimit = false,
}: {
  error: string | null;
  errorClass?: OrchestrationV2ProviderFailureClass | null;
  onDismiss?: () => void;
  chatGptUsageLimit?: boolean;
}) {
  const liveBanner = useMemo(
    () => (error ? { error, errorClass, chatGptUsageLimit } : null),
    [error, errorClass, chatGptUsageLimit],
  );
  const presence = usePresence(liveBanner);
  const banner = presence.value;
  if (!banner) return null;
  const variant = banner.errorClass === "usage_limit" ? "warning" : "error";
  return (
    <div
      {...presence.props}
      inert={presence.exiting}
      className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3 transition-[translate] duration-200 ease-drawer data-enter:starting:-translate-y-1 data-ending-style:-translate-y-1 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none"
    >
      <Alert variant={variant} surface="glass" controlAlignment="first-line" data-variant={variant}>
        {banner.chatGptUsageLimit ? (
          <OpenAI className="size-4 text-foreground!" aria-hidden="true" />
        ) : (
          <CircleAlertIcon />
        )}
        <AlertDescription>
          {banner.chatGptUsageLimit ? (
            <div className="space-y-1">
              <p className="font-medium">ChatGPT usage limit reached</p>
              <p>Review your usage settings in ChatGPT to continue.</p>
            </div>
          ) : (
            <Tooltip>
              <TooltipTrigger render={<div className="line-clamp-3" />}>
                {banner.error}
              </TooltipTrigger>
              <TooltipPopup side="top" className="whitespace-pre-wrap">
                {banner.error}
              </TooltipPopup>
            </Tooltip>
          )}
        </AlertDescription>
        {(banner.chatGptUsageLimit || onDismiss) && (
          <AlertAction>
            {banner.chatGptUsageLimit ? <ChatGptUsageButton variant="default" size="sm" /> : null}
            {onDismiss ? (
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
                <XIcon />
              </Button>
            ) : null}
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
