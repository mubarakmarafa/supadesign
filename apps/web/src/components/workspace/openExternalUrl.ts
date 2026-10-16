import { readLocalApi } from "../../localApi";

/** Opens a link in the system browser on desktop, or a new tab on web. */
export function openExternalUrl(url: string): void {
  const api = readLocalApi();
  if (api) {
    void api.shell.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
