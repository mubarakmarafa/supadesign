import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Textarea } from "../ui/textarea";
import { boardCardFromText } from "./boardLogic";

/**
 * A card being written in place at the top of a column. Enter adds it and
 * leaves the form open for the next one; Escape, Cancel, or leaving it empty
 * closes it.
 */
export function NewBoardCard({
  columnTitle,
  onAdd,
  onClose,
}: {
  columnTitle: string;
  /** Resolves true once the card exists, so the form can clear for the next one. */
  onAdd: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [adding, setAdding] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  const empty = boardCardFromText(text) === null;

  const add = async () => {
    if (empty || adding) return;
    setAdding(true);
    const added = await onAdd(text);
    setAdding(false);
    if (added) setText("");
  };

  return (
    <li className="list-none">
      <form
        ref={formRef}
        aria-label={`New card in ${columnTitle}`}
        className="flex flex-col gap-1 rounded-xl border border-ring bg-card text-sm shadow-sm ring-2 ring-ring/20"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
        onBlur={(event) => {
          // Clicking away from an empty card puts the form away.
          if (formRef.current?.contains(event.relatedTarget as Node | null)) return;
          if (empty && !adding) onClose();
        }}
      >
        <Textarea
          unstyled
          autoFocus
          aria-label="What do you want to work on?"
          placeholder="What do you want to work on?"
          value={text}
          // Read-only rather than disabled while adding, so focus stays for the next card.
          readOnly={adding}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void add();
            } else if (event.key === "Escape") {
              // Escape here closes the form and must not reach board shortcuts.
              event.preventDefault();
              event.stopPropagation();
              onClose();
            }
          }}
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <Button type="submit" size="xs" disabled={empty || adding}>
            {adding ? "Adding…" : "Add card"}
          </Button>
          <Button type="button" size="xs" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <span className="ms-auto flex items-center gap-1 text-2xs text-muted-foreground">
            <Kbd>⇧↵</Kbd> new line
          </span>
        </div>
      </form>
    </li>
  );
}
