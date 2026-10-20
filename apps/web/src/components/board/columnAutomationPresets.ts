/**
 * Ready-made column steps. Each one only fills in a step, which the designer
 * can then rename and rewrite; nothing refers back to the preset.
 */
export interface ColumnStepPreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
}

export const COLUMN_STEP_PRESETS: ReadonlyArray<ColumnStepPreset> = [
  {
    id: "plan-from-bank",
    name: "Plan from banked messages",
    description: "Turns the card's banked notes into a plan.",
    prompt:
      "Here are my notes for {card}:\n\n{banked}\n\nTurn them into a short plan. Don't change any files yet; wait for me to approve it.",
  },
  {
    id: "open-pr",
    name: "Open a pull request",
    description: "Commits, pushes, and opens a PR for the card's branch.",
    prompt:
      "Commit any remaining work on {branch}, push it, and open a pull request with a clear title and description. Reply with the link.",
  },
  {
    id: "merge",
    name: "Merge into main",
    description: "Merges the card's branch, stopping on conflicts.",
    prompt:
      "Merge {branch} into main and push main. If there are conflicts or failing checks, stop and tell me what's wrong instead of forcing it.",
  },
  {
    id: "delete-branch",
    name: "Delete the branch",
    description: "Removes the card's branch once it's merged.",
    prompt:
      "If {branch} has been merged into main, delete it locally and on the remote. If it hasn't been merged, don't delete anything; tell me instead.",
  },
  {
    id: "audit",
    name: "Audit the changes",
    description: "Reviews the work without changing files.",
    prompt:
      "Review the changes on {branch} for bugs, accessibility, and consistency with the rest of the design. List what you find, most important first. Don't change any files.",
  },
  {
    id: "custom",
    name: "Custom step",
    description: "Write your own prompt.",
    prompt: "",
  },
];

/** What a prompt can mention about the card, shown beside the prompt field. */
export const COLUMN_STEP_PLACEHOLDERS: ReadonlyArray<{
  readonly token: string;
  readonly meaning: string;
}> = [
  { token: "{card}", meaning: "the card's title" },
  { token: "{branch}", meaning: "its branch" },
  { token: "{column}", meaning: "the column it moved to" },
  { token: "{from}", meaning: "the column it came from" },
  { token: "{banked}", meaning: "its banked messages, which are then sent" },
];
