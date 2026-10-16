import { isFigmaUrl, type ProjectWorkspaceWidget } from "@supaterm/contracts";
import { ExternalLinkIcon, PenToolIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { MenuItem } from "../../ui/menu";
import { openExternalUrl } from "../openExternalUrl";
import { WidgetMessage, WorkspaceWidgetFrame, useWorkspaceFrame } from "../WorkspaceWidgetFrame";
import { figmaEmbedUrl, setWorkspaceWidgetSettings } from "../workspaceLogic";

/** A pasted Figma file, design, or prototype, to hold beside the live preview. */
export function FigmaWidget({ widget }: { widget: ProjectWorkspaceWidget }) {
  const { workspace, canEdit, commit } = useWorkspaceFrame();
  const [editing, setEditing] = useState(false);
  const url = widget.figmaUrl ?? null;
  const showForm = canEdit && (url === null || editing);

  return (
    <WorkspaceWidgetFrame
      widget={widget}
      title="Figma"
      icon={<PenToolIcon />}
      actions={
        url !== null ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Open in Figma"
            onClick={() => openExternalUrl(url)}
          >
            <ExternalLinkIcon />
          </Button>
        ) : null
      }
      menuItems={
        url !== null ? <MenuItem onClick={() => setEditing(true)}>Change link…</MenuItem> : null
      }
    >
      {showForm ? (
        <FigmaLinkForm
          initial={url ?? ""}
          onCancel={url === null ? null : () => setEditing(false)}
          onSubmit={(next) => {
            setEditing(false);
            commit(setWorkspaceWidgetSettings(workspace, widget.id, { figmaUrl: next }));
          }}
        />
      ) : url !== null ? (
        <iframe
          title="Figma embed"
          src={figmaEmbedUrl(url)}
          // Figma needs its own storage to load. Its origin is never the app's, so
          // same-origin grants nothing here; the sandbox still blocks top navigation.
          // oxlint-disable-next-line react/iframe-missing-sandbox
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
          allowFullScreen
          className="min-h-0 w-full flex-1 border-0"
        />
      ) : (
        <WidgetMessage>No Figma link yet.</WidgetMessage>
      )}
    </WorkspaceWidgetFrame>
  );
}

function FigmaLinkForm({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (url: string) => void;
  onCancel: (() => void) | null;
}) {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!isFigmaUrl(trimmed)) {
      setInvalid(true);
      return;
    }
    onSubmit(trimmed);
  };
  return (
    <form
      onSubmit={submit}
      className="flex min-h-0 flex-1 flex-col items-stretch justify-center gap-2 p-4"
    >
      <label htmlFor="figma-link" className="text-sm text-muted-foreground">
        Paste a Figma file, design, or prototype link to compare it with the live preview.
      </label>
      <Input
        id="figma-link"
        size="sm"
        type="url"
        placeholder="https://www.figma.com/proto/…"
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
      />
      {invalid ? (
        <p className="text-xs text-destructive-foreground">That isn't a figma.com link.</p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button size="sm" variant="ghost" type="button" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button size="sm" type="submit">
          Embed
        </Button>
      </div>
    </form>
  );
}
