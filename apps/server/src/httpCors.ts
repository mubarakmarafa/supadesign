import { ORCHESTRATION_PROTOCOL_HEADER } from "@supaterm/contracts";
import { APP_DEV_URL_SCHEME, APP_URL_SCHEME } from "@supaterm/shared/appIdentity";

export const browserApiCorsAllowedMethods = ["GET", "POST", "OPTIONS"] as const;
export const browserApiCorsAllowedHeaders = [
  "authorization",
  "b3",
  "traceparent",
  "content-type",
  "dpop",
  ORCHESTRATION_PROTOCOL_HEADER,
] as const;

/** Origins of the Electron renderer, packaged and dev. */
export const DESKTOP_RENDERER_ORIGINS = [
  `${APP_URL_SCHEME}://app`,
  `${APP_DEV_URL_SCHEME}://app`,
] as const;
