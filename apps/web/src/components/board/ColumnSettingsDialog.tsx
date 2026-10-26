import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import {
  BOARD_AUTOMATION_MAX_STEPS,
  BOARD_AUTOMATION_NAME_MAX_LENGTH,
  BOARD_AUTOMATION_PROMPT_MAX_LENGTH,
  type BoardAutomationStep,
  BoardAutomationStepId,
  type BoardColumnId,
  type EnvironmentId,
  type ModelSelection,
  type ProjectBoard,
} from "@supaterm/contracts";
import { createModelSelection } from "@supaterm/shared/model";
import { useAtomValue } from "@effect/atom-react";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { randomUUID } from "../../lib/utils";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { scheduledTaskDefaultModel } from "../automations/automations.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { SETTINGS_PICKER_TRIGGER_CLASSNAME } from "../settings/settingsLayout";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { Textarea } from "../ui/textarea";
import { type BoardColumnSettings, boardColumnSettings } from "./boardLogic";
import {
  COLUMN_STEP_PLACEHOLDERS,
  COLUMN_STEP_PRESETS,
  type ColumnStepPreset,
} from "./columnAutomationPresets";

/** A step being edited; its name and prompt may still be empty. */
interface StepDraft {
  readonly id: BoardAutomationStepId;
  readonly name: string;
  readonly prompt: string;
  readonly modelSelection: ModelSelection | undefined;
}

type Trigger = "onEnter" | "onLeave";

const toDraft = (step: BoardAutomationStep): StepDraft => ({
  id: step.id,
  name: step.name,
  prompt: step.prompt,
  modelSelection: step.modelSelection,
});

const fromDraft = (draft: StepDraft): BoardAutomationStep | null => {
  const name = draft.name.trim();
  const prompt = draft.prompt.trim();
  if (name.length === 0 || prompt.length === 0) return null;
  return {
    id: draft.id,
    name,
    prompt,
    ...(draft.modelSelection === undefined ? {} : { modelSelection: draft.modelSelection }),
  };
};

/** Picks the model a step runs on: the card's own, or one chosen here with its effort. */
function StepModelPicker({
  environmentId,
  project,
  value,
  onChange,
}: {
  environmentId: EnvironmentId;
  project: EnvironmentProject;
  value: ModelSelection | undefined;
  onChange: (value: ModelSelection | undefined) => void;
}) {
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? EMPTY_SERVER_PROVIDERS;
  const instanceEntries = useMemo(
    () =>
      sortProviderInstanceEntries(
        applyProviderInstanceSettings(
          deriveProviderInstanceEntries(providers),
          settings,
          project.id,
        ),
      ),
    [project.id, providers, settings],
  );
  const fallback = scheduledTaskDefaultModel(settings, project, instanceEntries);
  const selection = value ?? fallback;
  const modelOptionsByInstance = useMemo(
    () =>
      getCustomModelOptionsByInstance(
        settings,
        providers,
        selection?.instanceId ?? instanceEntries[0]?.instanceId,
        selection?.model ?? "",
      ),
    [instanceEntries, providers, selection?.instanceId, selection?.model, settings],
  );
  const entry = instanceEntries.find((candidate) => candidate.instanceId === selection?.instanceId);
  const switchId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Switch
        id={switchId}
        checked={value === undefined}
        disabled={value === undefined && fallback === null}
        onCheckedChange={(cardModel) => onChange(cardModel ? undefined : (fallback ?? undefined))}
      />
      <Label htmlFor={switchId}>Use the card's model</Label>
      {value !== undefined && selection !== null ? (
        <>
          <ProviderModelPicker
            environmentId={environmentId}
            activeInstanceId={selection.instanceId}
            model={selection.model}
            lockedProvider={null}
            instanceEntries={instanceEntries}
            modelOptionsByInstance={modelOptionsByInstance}
            isComposerOwned={false}
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            triggerAriaLabel="Step model"
            onInstanceModelChange={(instanceId, model) =>
              onChange(createModelSelection(instanceId, model))
            }
          />
          {entry ? (
            <TraitsPicker
              provider={entry.driverKind}
              models={entry.models}
              model={selection.model}
              modelOptions={selection.options ?? []}
              allowPromptInjectedEffort={false}
              triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
              onModelOptionsChange={(options) =>
                onChange(createModelSelection(selection.instanceId, selection.model, options))
              }
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function StepEditor({
  environmentId,
  project,
  step,
  onChange,
  onRemove,
}: {
  environmentId: EnvironmentId;
  project: EnvironmentProject;
  step: StepDraft;
  onChange: (step: StepDraft) => void;
  onRemove: () => void;
}) {
  const nameId = useId();
  const promptId = useId();
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-2">
        <Input
          id={nameId}
          size="sm"
          aria-label="Step name"
          placeholder="Step name"
          maxLength={BOARD_AUTOMATION_NAME_MAX_LENGTH}
          className="min-w-0 flex-1"
          value={step.name}
          onChange={(event) => onChange({ ...step, name: event.target.value })}
        />
        <Button
          size="icon-sm"
          variant="ghost-muted"
          aria-label={`Remove ${step.name || "this step"}`}
          onClick={onRemove}
        >
          <Trash2Icon />
        </Button>
      </div>
      <Textarea
        id={promptId}
        aria-label="Prompt"
        placeholder="What should the card's agent do?"
        maxLength={BOARD_AUTOMATION_PROMPT_MAX_LENGTH}
        className="max-h-48 overflow-y-auto"
        value={step.prompt}
        onChange={(event) => onChange({ ...step, prompt: event.target.value })}
      />
      <StepModelPicker
        environmentId={environmentId}
        project={project}
        value={step.modelSelection}
        onChange={(modelSelection) => onChange({ ...step, modelSelection })}
      />
    </div>
  );
}

function StepList({
  title,
  description,
  environmentId,
  project,
  steps,
  onChange,
}: {
  title: string;
  description: string;
  environmentId: EnvironmentId;
  project: EnvironmentProject;
  steps: ReadonlyArray<StepDraft>;
  onChange: (steps: ReadonlyArray<StepDraft>) => void;
}) {
  const full = steps.length >= BOARD_AUTOMATION_MAX_STEPS;
  const add = (preset: ColumnStepPreset) =>
    onChange([
      ...steps,
      {
        id: BoardAutomationStepId.make(`step-${randomUUID().slice(0, 8)}`),
        name: preset.id === "custom" ? "" : preset.name,
        prompt: preset.prompt,
        modelSelection: undefined,
      },
    ]);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Menu>
          <MenuTrigger
            disabled={full}
            render={<Button size="sm" variant="outline" className="shrink-0" />}
          >
            <PlusIcon />
            Add step
          </MenuTrigger>
          <MenuPopup align="end">
            {COLUMN_STEP_PRESETS.map((preset) => (
              <MenuItem key={preset.id} onClick={() => add(preset)}>
                <span className="flex min-w-0 flex-col">
                  <span>{preset.name}</span>
                  <span className="text-xs text-muted-foreground">{preset.description}</span>
                </span>
              </MenuItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
      {steps.map((step, index) => (
        <StepEditor
          key={step.id}
          environmentId={environmentId}
          project={project}
          step={step}
          onChange={(next) => onChange(steps.with(index, next))}
          onRemove={() => onChange(steps.toSpliced(index, 1))}
        />
      ))}
    </section>
  );
}

function BuiltInToggle({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

/**
 * Names a column and sets what happens when cards move through it: the
 * built-in live preview and banked-message sending, and prompt steps sent to
 * a card's own agent when it arrives or leaves. `columnId` null makes a new column.
 */
export function ColumnSettingsDialog({
  environmentId,
  project,
  board,
  columnId,
  automationsSupported,
  onSave,
  onClose,
}: {
  environmentId: EnvironmentId;
  project: EnvironmentProject;
  board: ProjectBoard;
  columnId: BoardColumnId | null;
  /** False on servers that predate column automations; only built-ins show. */
  automationsSupported: boolean;
  onSave: (settings: BoardColumnSettings) => void;
  onClose: () => void;
}) {
  const initial = columnId === null ? null : boardColumnSettings(board, columnId);
  const [title, setTitle] = useState(initial?.title ?? "");
  const [live, setLive] = useState(initial?.live ?? false);
  const [send, setSend] = useState(initial?.send ?? false);
  const [moveWhenDone, setMoveWhenDone] = useState<BoardColumnId | null>(
    initial?.moveWhenDone ?? null,
  );
  const [steps, setSteps] = useState<Record<Trigger, ReadonlyArray<StepDraft>>>({
    onEnter: (initial?.onEnter ?? []).map(toDraft),
    onLeave: (initial?.onLeave ?? []).map(toDraft),
  });
  const isDone = columnId !== null && columnId === board.doneColumnId;
  const titleOf = (id: BoardColumnId | null | undefined) =>
    board.columns.find((column) => column.id === id)?.title ?? null;
  const liveElsewhere = board.liveColumnId !== columnId ? titleOf(board.liveColumnId) : null;
  const sendElsewhere = board.sendColumnId !== columnId ? titleOf(board.sendColumnId) : null;
  const incomplete = [...steps.onEnter, ...steps.onLeave].some((step) => fromDraft(step) === null);
  const canSave = title.trim().length > 0 && !incomplete;
  const titleId = useId();
  const moveId = useId();
  const moveTargets = board.columns.filter((column) => column.id !== columnId);

  const save = () => {
    if (!canSave) return;
    const finished = (drafts: ReadonlyArray<StepDraft>) =>
      drafts.flatMap((draft) => fromDraft(draft) ?? []);
    onSave({
      title,
      live,
      send,
      onEnter: finished(steps.onEnter),
      onLeave: finished(steps.onLeave),
      moveWhenDone,
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{columnId === null ? "New column" : "Column settings"}</DialogTitle>
          <DialogDescription>
            Choose what happens when a card moves into or out of this column.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={titleId}>Name</Label>
              <Input
                id={titleId}
                autoFocus
                placeholder="e.g. Ship"
                maxLength={60}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    save();
                  }
                }}
              />
            </div>
            {isDone ? (
              <p className="text-sm text-muted-foreground">
                Done archives its cards, so nothing runs here. To merge or clean up when work is
                finished, add those steps to a column before Done.
              </p>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <BuiltInToggle
                    label="Live preview"
                    description={
                      liveElsewhere && !live
                        ? `The top card runs its dev server. Moves it from ${liveElsewhere}.`
                        : "The top card runs its dev server."
                    }
                    checked={live}
                    onCheckedChange={setLive}
                  />
                  <BuiltInToggle
                    label="Send banked messages"
                    description={
                      sendElsewhere && !send
                        ? `A card's banked messages are sent when it arrives. Moves it from ${sendElsewhere}.`
                        : "A card's banked messages are sent when it arrives."
                    }
                    checked={send}
                    onCheckedChange={setSend}
                  />
                </div>
                {automationsSupported ? (
                  <>
                    <StepList
                      title="When a card arrives"
                      description="Sent to the card's agent a few seconds after it moves in."
                      environmentId={environmentId}
                      project={project}
                      steps={steps.onEnter}
                      onChange={(onEnter) => setSteps((current) => ({ ...current, onEnter }))}
                    />
                    {steps.onEnter.length > 0 ? (
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <Label htmlFor={moveId}>When the agent reports them done</Label>
                          <p className="text-xs text-muted-foreground">
                            A card whose agent is blocked stays here and is flagged for you.
                          </p>
                        </div>
                        <div className="w-48 shrink-0">
                          <Select
                            value={moveWhenDone ?? ""}
                            onValueChange={(value) =>
                              setMoveWhenDone(value ? (value as BoardColumnId) : null)
                            }
                          >
                            <SelectTrigger id={moveId} size="sm">
                              <SelectValue>
                                {moveWhenDone === null
                                  ? "Keep the card here"
                                  : `Move it to ${
                                      board.columns.find((column) => column.id === moveWhenDone)
                                        ?.title ?? "another column"
                                    }`}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="">Keep the card here</SelectItem>
                              {moveTargets.map((column) => (
                                <SelectItem key={column.id} value={column.id}>
                                  Move it to {column.title}
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>
                      </div>
                    ) : null}
                    <StepList
                      title="When a card leaves"
                      description="Sent before the next column's steps. Nothing runs on a card moved to Done."
                      environmentId={environmentId}
                      project={project}
                      steps={steps.onLeave}
                      onChange={(onLeave) => setSteps((current) => ({ ...current, onLeave }))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Prompts can mention{" "}
                      {COLUMN_STEP_PLACEHOLDERS.map((placeholder, index) => (
                        <span key={placeholder.token}>
                          {index > 0 ? ", " : null}
                          <code className="font-mono text-foreground">{placeholder.token}</code> (
                          {placeholder.meaning})
                        </span>
                      ))}
                      .
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Update this environment's server to add steps that run when cards move.
                  </p>
                )}
              </>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>Cancel</DialogClose>
          <Button size="sm" disabled={!canSave} onClick={save}>
            {columnId === null ? "Add column" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
