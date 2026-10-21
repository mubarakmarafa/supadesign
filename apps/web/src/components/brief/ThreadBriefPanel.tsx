import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@supaterm/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@supaterm/client-runtime/state/runtime";
import {
  THREAD_BRIEF_MAX_LENGTH,
  THREAD_DECISION_MAX_LENGTH,
  ThreadId,
  type EnvironmentId,
  type ProjectId,
  type ThreadDecision,
  type ThreadDecisionId,
} from "@supaterm/contracts";
import { CheckIcon, PencilIcon, PlusIcon, SparklesIcon, XIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useThreadShell } from "../../state/entities";
import { threadBrief } from "../../state/threadBrief";
import { useAtomCommand } from "../../state/use-atom-command";
import { useThreadBankEntries } from "../chat/threadBankState";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { DisclosureChevron } from "../ui/disclosure-chevron";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { briefSeedSource, decisionCounts, decisionPillLabel } from "./brief.logic";
import { useProjectThreadBriefs, useThreadBriefSupported } from "./briefState";

const BRIEF_OPEN_KEY = "supadesign:thread-brief-open";
const NO_DECISIONS: ReadonlyArray<ThreadDecision> = [];

function failureToast(title: string, result: AtomCommandResult<unknown, unknown>) {
  if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
  const error = squashAtomCommandFailure(result);
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "Something went wrong.",
    }),
  );
}

/**
 * The card's brief and decisions, pinned under the thread's header. Agents
 * read them and suggest decisions; the designer writes the brief and settles
 * every suggestion here.
 */
export function ThreadBriefPanel({
  environmentId,
  threadId,
  projectId,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  projectId: ProjectId;
}) {
  const supported = useThreadBriefSupported(environmentId);
  const current = useProjectThreadBriefs(environmentId, projectId).get(threadId);
  const canEdit = useAtomValue(threadBrief.setBrief.permissionAtom(environmentId));
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, threadId),
    [environmentId, threadId],
  );
  const thread = useThreadShell(threadRef);
  const banked = useThreadBankEntries(environmentId, projectId, threadId);
  const [open, setOpen] = useLocalStorage(BRIEF_OPEN_KEY, true, Schema.Boolean);
  const [editingBrief, setEditingBrief] = useState<string | null>(null);
  const setBrief = useAtomCommand(threadBrief.setBrief, { reportFailure: false });
  const seedBrief = useAtomCommand(threadBrief.seedBrief, { reportFailure: false });

  if (!supported) return null;
  const brief = current?.brief ?? null;
  const decisions = current?.decisions ?? NO_DECISIONS;
  if (brief === null && decisions.length === 0 && !canEdit) return null;

  const counts = decisionCounts(current);
  const pill = decisionPillLabel(counts);
  const seedSource = briefSeedSource({
    hasSentMessage: thread?.latestUserMessageAt != null,
    bankedNote: banked.some((entry) => entry.text.trim().length > 0),
  });
  const firstLine = brief?.text.split("\n", 1)[0] ?? null;

  const startEditing = () => {
    setOpen(true);
    setEditingBrief(brief?.text ?? "");
  };
  const saveBrief = async (text: string) => {
    const result = await setBrief({ environmentId, input: { threadId, text } });
    if (result._tag === "Success") setEditingBrief(null);
    else failureToast("Couldn't save the brief", result);
  };
  const seed = async () => {
    const result = await seedBrief({ environmentId, input: { threadId } });
    failureToast("Couldn't start the brief", result);
  };

  return (
    <section aria-label="Brief" className="shrink-0 border-b bg-background px-3 py-1 sm:px-5">
      <div className="flex min-h-7 items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-sm text-start text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <DisclosureChevron open={open} />
          <span className="shrink-0 font-medium">Brief</span>
          {!open ? <span className="min-w-0 truncate">{firstLine ?? "No brief yet"}</span> : null}
        </button>
        {pill ? (
          <span
            className={cn(
              "shrink-0 text-xs",
              counts.toReview > 0 ? "text-warning-foreground" : "text-muted-foreground",
            )}
          >
            {pill}
          </span>
        ) : null}
        {canEdit && brief !== null && editingBrief === null ? (
          <Button size="xs" variant="ghost-muted" onClick={startEditing}>
            <PencilIcon />
            Edit
          </Button>
        ) : null}
      </div>
      {open ? (
        <div className="flex max-h-[40vh] flex-col gap-3 overflow-y-auto pt-1 pb-2">
          {editingBrief !== null ? (
            <BriefEditor
              initial={editingBrief}
              onSave={(text) => void saveBrief(text)}
              onCancel={() => setEditingBrief(null)}
            />
          ) : brief !== null ? (
            <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere text-foreground">
              {brief.text}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm text-muted-foreground">
                No brief yet. Write down where this card is headed, so you and the agent stay on the
                same page.
              </p>
              {canEdit ? (
                <>
                  <Button size="xs" variant="outline" onClick={startEditing}>
                    Write a brief
                  </Button>
                  {seedSource !== null ? (
                    <Button size="xs" variant="ghost" onClick={() => void seed()}>
                      {seedSource === "note"
                        ? "Start from the card note"
                        : "Start from the first message"}
                    </Button>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
          <DecisionList
            environmentId={environmentId}
            threadId={threadId}
            decisions={decisions}
            canEdit={canEdit}
          />
        </div>
      ) : null}
    </section>
  );
}

function BriefEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    onSave(text);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      submit();
    }
  };
  return (
    <form className="flex flex-col gap-2" onSubmit={submit}>
      <Textarea
        autoFocus
        aria-label="Brief"
        rows={3}
        maxLength={THREAD_BRIEF_MAX_LENGTH}
        placeholder="What is this card for, and what does done look like?"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="flex items-center justify-end gap-2">
        <span className="me-auto text-xs text-muted-foreground">
          Earlier versions of the brief are kept.
        </span>
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={text.trim() === initial.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

function DecisionList({
  environmentId,
  threadId,
  decisions,
  canEdit,
}: {
  environmentId: EnvironmentId;
  threadId: ThreadId;
  decisions: ReadonlyArray<ThreadDecision>;
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<ThreadDecisionId | null>(null);
  const addDecision = useAtomCommand(threadBrief.addDecision, { reportFailure: false });
  const acceptDecision = useAtomCommand(threadBrief.acceptDecision, { reportFailure: false });
  const rejectDecision = useAtomCommand(threadBrief.rejectDecision, { reportFailure: false });
  const restoreDecision = useAtomCommand(threadBrief.restoreDecision, { reportFailure: false });

  const add = async (text: string) => {
    const result = await addDecision({ environmentId, input: { threadId, text } });
    if (result._tag === "Success") setAdding(false);
    else failureToast("Couldn't add the decision", result);
  };
  const accept = async (decisionId: ThreadDecisionId, text?: string) => {
    const result = await acceptDecision({
      environmentId,
      input: text === undefined ? { threadId, decisionId } : { threadId, decisionId, text },
    });
    if (result._tag === "Success") setEditingId(null);
    else failureToast("Couldn't save the decision", result);
  };
  const reject = async (decision: ThreadDecision) => {
    const result = await rejectDecision({
      environmentId,
      input: { threadId, decisionId: decision.id },
    });
    if (result._tag !== "Success") {
      failureToast("Couldn't remove the decision", result);
      return;
    }
    toastManager.add(
      stackedThreadToast({
        type: "info",
        title: decision.status === "suggested" ? "Suggestion rejected" : "Decision removed",
        description: decision.text,
        actionProps: {
          children: "Undo",
          onClick: () => {
            void restoreDecision({
              environmentId,
              input: { threadId, decisionId: decision.id },
            }).then((restored) => failureToast("Couldn't bring the decision back", restored));
          },
        },
      }),
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center gap-2">
        <h3 className="flex-1 text-xs font-medium text-muted-foreground">Decisions</h3>
        {canEdit && !adding ? (
          <Button size="xs" variant="ghost-muted" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add
          </Button>
        ) : null}
      </div>
      {decisions.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">
          None yet. Choices you make, or the agent suggests, collect here.
        </p>
      ) : null}
      {decisions.length > 0 ? (
        <ul className="flex flex-col">
          {decisions.map((decision) =>
            editingId === decision.id ? (
              <li key={decision.id} className="py-1">
                <DecisionEditor
                  initial={decision.text}
                  saveLabel={decision.status === "suggested" ? "Accept" : "Save"}
                  onSave={(text) => void accept(decision.id, text)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <DecisionRow
                key={decision.id}
                decision={decision}
                canEdit={canEdit}
                onAccept={() => void accept(decision.id)}
                onEdit={() => setEditingId(decision.id)}
                onReject={() => void reject(decision)}
              />
            ),
          )}
        </ul>
      ) : null}
      {adding ? (
        <DecisionEditor
          initial=""
          saveLabel="Add"
          placeholder="What did you decide?"
          onSave={(text) => void add(text)}
          onCancel={() => setAdding(false)}
        />
      ) : null}
    </div>
  );
}

function DecisionRow({
  decision,
  canEdit,
  onAccept,
  onEdit,
  onReject,
}: {
  decision: ThreadDecision;
  canEdit: boolean;
  onAccept: () => void;
  onEdit: () => void;
  onReject: () => void;
}) {
  const suggested = decision.status === "suggested";
  return (
    <li className="group/decision flex items-start gap-2 py-1">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex shrink-0 [&_svg]:size-3.5",
          suggested ? "text-warning-foreground" : "text-success-foreground",
        )}
      >
        {suggested ? <SparklesIcon /> : <CheckIcon />}
      </span>
      <p className="min-w-0 flex-1 text-sm leading-snug wrap-anywhere text-foreground">
        {decision.text}
        {suggested ? (
          <span className="ms-1.5 inline-flex align-middle">
            <Badge variant="warning" size="sm">
              Suggested
            </Badge>
          </span>
        ) : decision.status === "edited" ? (
          <span className="ms-1.5 inline-flex align-middle">
            <Badge variant="secondary" size="sm">
              Edited
            </Badge>
          </span>
        ) : null}
      </p>
      {canEdit && suggested ? (
        <span className="flex shrink-0 items-center gap-1">
          <Button size="xs" variant="outline" onClick={onAccept}>
            Accept
          </Button>
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="ghost-destructive" onClick={onReject}>
            Reject
          </Button>
        </span>
      ) : canEdit ? (
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover/decision:opacity-100 group-focus-within/decision:opacity-100 pointer-coarse:opacity-100">
          <Button size="icon-xs" variant="ghost-muted" aria-label="Edit decision" onClick={onEdit}>
            <PencilIcon />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost-destructive"
            aria-label="Remove decision"
            onClick={onReject}
          >
            <XIcon />
          </Button>
        </span>
      ) : null}
    </li>
  );
}

function DecisionEditor({
  initial,
  saveLabel,
  placeholder,
  onSave,
  onCancel,
}: {
  initial: string;
  saveLabel: string;
  placeholder?: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (text.trim().length > 0) onSave(text);
  };
  return (
    <form className="flex items-center gap-2" onSubmit={submit}>
      <Input
        autoFocus
        size="sm"
        aria-label="Decision"
        maxLength={THREAD_DECISION_MAX_LENGTH}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" size="xs" disabled={text.trim().length === 0}>
        {saveLabel}
      </Button>
    </form>
  );
}
