import { renderMermaidAscii } from "@supaterm/mermaid-ascii";

self.addEventListener("message", (event: MessageEvent<{ source: string }>) => {
  try {
    self.postMessage({ output: renderMermaidAscii(event.data.source) }, { transfer: [] });
  } catch {
    self.postMessage({ error: true }, { transfer: [] });
  }
});

self.postMessage({ ready: true }, { transfer: [] });
