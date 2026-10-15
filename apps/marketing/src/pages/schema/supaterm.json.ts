import type { APIRoute } from "astro";

import { buildSupatermProjectFileJsonSchema } from "@supaterm/shared/supatermProjectFile";

// Rendered at build time; published at https://supaterm.com/schema/supaterm.json so
// supaterm.json files can reference it via "$schema" for editor/LSP support.
export const GET: APIRoute = () =>
  new Response(`${JSON.stringify(buildSupatermProjectFileJsonSchema(), null, 2)}\n`, {
    headers: { "Content-Type": "application/json" },
  });
