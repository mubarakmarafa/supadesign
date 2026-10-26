import type { ModelSelection } from "@supaterm/contracts";
import {
  getProviderOptionCurrentLabel,
  getProviderOptionDescriptors,
} from "@supaterm/shared/model";

import { getTriggerDisplayModelLabel } from "../chat/providerIconUtils";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { getProviderModelCapabilities } from "../../providerModels";

/** Option ids providers use for how hard the model thinks. */
const EFFORT_DESCRIPTOR_IDS = ["effort", "reasoningEffort", "reasoning", "variant"];

/**
 * What a card's agent runs on, as "Sonnet 5.5 · High", so a card is never moved
 * into a sending column without its model being visible. The provider's name
 * is left to the logo beside it. Falls back to the raw slug when the provider
 * is not loaded.
 */
export function cardModelLabel(
  selection: ModelSelection,
  entry: ProviderInstanceEntry | undefined,
): string {
  const model = entry?.models.find((candidate) => candidate.slug === selection.model);
  if (!entry || !model) return selection.model;
  const descriptors = getProviderOptionDescriptors({
    caps: getProviderModelCapabilities(entry.models, selection.model, entry.driverKind),
    selections: selection.options,
  });
  const effort = EFFORT_DESCRIPTOR_IDS.map((id) =>
    descriptors.find((descriptor) => descriptor.id === id && descriptor.type === "select"),
  ).find((descriptor) => descriptor !== undefined);
  const effortLabel = getProviderOptionCurrentLabel(effort, selection);
  const fullName = getTriggerDisplayModelLabel(model);
  const prefix = `${entry.displayName} `;
  const name = fullName.startsWith(prefix) ? fullName.slice(prefix.length) : fullName;
  return effortLabel ? `${name} · ${effortLabel}` : name;
}
