/**
 * Names this fork registers with the OS, so it can be installed next to the
 * official Supaterm/Supacode app without sharing a bundle ID, URL scheme, data
 * directory, port, launcher, or background service.
 *
 * Internal package names (`@supaterm/*`) and `SUPATERM_*` environment variables
 * are deliberately unchanged to keep upstream merges small.
 */
export const APP_PRODUCT_NAME = "Supadesign";
export const APP_ID = "com.mubarakmarafa.supadesign";
export const APP_SLUG = "supadesign";
export const APP_URL_SCHEME = APP_SLUG;
export const APP_DEV_URL_SCHEME = `${APP_SLUG}-dev`;
export const APP_HOME_DIRECTORY_NAME = `.${APP_SLUG}`;
export const APP_CLI_COMMAND = APP_SLUG;
export const APP_REPOSITORY = "mubarakmarafa/supadesign";
