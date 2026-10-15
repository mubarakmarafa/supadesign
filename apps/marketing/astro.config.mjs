import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://supaterm.com",
  server: {
    port: Number(process.env.PORT ?? 4173),
  },
});
