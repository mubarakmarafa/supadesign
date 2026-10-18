import {
  THREAD_SUMMARY_MAX_LENGTH,
  ThreadId,
  type EnvironmentId,
  type ThreadSummary,
} from "@supaterm/contracts";
import { useId, useState } from "react";

import { threadProgress } from "../../state/threadProgress";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";

/** Edits the summary on a card. The designer's words stay until they clear them. */
export function SummaryDialog({
  environmentId,
  threadId,
  summary,
  fallback,
  onOpenChange,
}: {
  environmentId: EnvironmentId;
  threadId: string;
  summary: ThreadSummary | null;
  /** What the card shows today when there's no summary of the designer's. */
  fallback: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const id = useId();
  const setSummary = useAtomCommand(threadProgress.setSummary);
  const ownSummary = summary?.source === "designer";
  const [text, setText] = useState(summary?.text ?? fallback ?? "");
  const [saving, setSaving] = useState(false);
  const save = async (value: string) => {
    setSaving(true);
    const result = await setSummary({
      environmentId,
      input: { threadId: ThreadId.make(threadId), text: value },
    });
    setSaving(false);
    if (result._tag === "Success") onOpenChange(false);
  };
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void save(text);
          }}
        >
          <DialogHeader>
            <DialogTitle>Card summary</DialogTitle>
            <DialogDescription>
              A line or two under the card's title. The agent keeps it current unless you write your
              own.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Label className="flex flex-col items-stretch" htmlFor={id}>
              Summary
              <Textarea
                id={id}
                autoFocus
                rows={3}
                maxLength={THREAD_SUMMARY_MAX_LENGTH}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Label>
          </DialogPanel>
          <DialogFooter>
            {ownSummary ? (
              <Button
                type="button"
                variant="ghost"
                className="sm:me-auto"
                disabled={saving}
                onClick={() => void save("")}
              >
                Let the agent write it
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || text.trim().length === 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
