import { createDiagramRenderer } from "@supaterm/client-runtime/diagram-rendering";
import { MERMAID_ASCII_LIMITS } from "@supaterm/mermaid-ascii/limits";

export function createBrowserDiagramRenderer() {
  let worker: Worker | undefined;
  let ready = false;

  return createDiagramRenderer(
    (source) =>
      new Promise<string | null>((resolve, reject) => {
        const activeWorker = (worker ??= new Worker(
          new URL("./mermaid.worker.ts", import.meta.url),
          {
            type: "module",
          },
        ));
        let settled = false;
        let sent = false;
        const finish = (output: string | null, terminate = false) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          activeWorker.removeEventListener("message", handleMessage);
          activeWorker.removeEventListener("error", handleError);
          activeWorker.removeEventListener("messageerror", handleMessageError);
          if (terminate) {
            activeWorker.terminate();
            worker = undefined;
            ready = false;
            reject(new Error("Diagram preview unavailable"));
          } else {
            resolve(output);
          }
        };
        let timer = setTimeout(() => finish(null, true), 15_000);
        const send = () => {
          if (sent) return;
          sent = true;
          clearTimeout(timer);
          timer = setTimeout(() => finish(null, true), MERMAID_ASCII_LIMITS.durationMs * 2);
          try {
            activeWorker.postMessage({ source }, []);
          } catch {
            finish(null, true);
          }
        };
        const handleMessage = (event: MessageEvent<unknown>) => {
          const data = event.data;
          if (typeof data !== "object" || data === null) {
            finish(null, true);
            return;
          }
          if (!sent) {
            if (!("ready" in data) || data.ready !== true) {
              finish(null, true);
              return;
            }
            ready = true;
            send();
          } else if ("output" in data && typeof data.output === "string") {
            finish(data.output);
          } else if ("error" in data && data.error === true) {
            finish(null);
          } else {
            finish(null, true);
          }
        };
        const handleError = (event: ErrorEvent) => {
          event.preventDefault();
          finish(null, true);
        };
        const handleMessageError = () => finish(null, true);
        activeWorker.addEventListener("message", handleMessage);
        activeWorker.addEventListener("error", handleError);
        activeWorker.addEventListener("messageerror", handleMessageError);
        if (ready) send();
      }),
  );
}

const renderer = createBrowserDiagramRenderer();

export function renderMermaidDiagram(source: string) {
  return renderer.render(source);
}
