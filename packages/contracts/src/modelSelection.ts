import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelections } from "./model.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

/**
 * Selection of a model on a configured provider instance.
 *
 * `instanceId` is the routing key. The provider driver, credentials,
 * environment, and continuation identity are resolved by the provider
 * instance registry rather than encoded into the selection itself.
 */
export const ModelSelection = Schema.Struct({
  instanceId: ProviderInstanceId,
  model: TrimmedNonEmptyString,
  options: Schema.optionalKey(ProviderOptionSelections),
});
export type ModelSelection = typeof ModelSelection.Type;
