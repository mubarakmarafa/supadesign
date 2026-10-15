import type { ServerProcessSignal } from "@supaterm/contracts";

import { useInlineConfirm } from "../../hooks/useInlineConfirm";
import { InlineConfirmIcon } from "../InlineConfirm";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Process ownership stays with the diagnostics view. */
export function ProcessSignalActions({
  pid,
  disabled,
  onSignal,
}: {
  pid: number;
  disabled: boolean;
  onSignal: (signal: ServerProcessSignal) => void;
}) {
  const confirm = useInlineConfirm<"kill">();
  const killArmed = confirm.armed === "kill";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label="Send SIGINT"
              tone="muted"
              onClick={() => onSignal("SIGINT")}
            >
              INT
            </InlineButton>
          }
        />
        <TooltipPopup side="top">Send SIGINT</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label={killArmed ? "Confirm SIGKILL" : "Send SIGKILL"}
              tone="destructive"
              {...confirm.bind("kill", () => onSignal("SIGKILL"))}
            >
              <InlineConfirmIcon armed={killArmed}>KILL</InlineConfirmIcon>
            </InlineButton>
          }
        />
        <TooltipPopup side="top">
          {killArmed
            ? `Click again to send SIGKILL to process ${pid}. The process can’t handle it.`
            : "Send SIGKILL"}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
