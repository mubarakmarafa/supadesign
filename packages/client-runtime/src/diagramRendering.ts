import { MERMAID_ASCII_LIMITS } from "@supaterm/mermaid-ascii/limits";

export function createDiagramRenderer(
  render: (source: string) => Promise<string | null>,
  options: {
    maxPending?: number;
    maxCacheEntries?: number;
    maxCacheBytes?: number;
  } = {},
) {
  const maxPending = options.maxPending ?? 32;
  const maxCacheEntries = options.maxCacheEntries ?? 128;
  const maxCacheBytes = options.maxCacheBytes ?? 2 * 1024 * 1024;
  const cache = new Map<string, { output: string | null; bytes: number }>();
  const pending = new Map<string, Promise<string | null>>();
  const queue: Array<{ source: string; resolve: (output: string | null) => void }> = [];
  let cacheBytes = 0;
  let running = false;

  function remember(source: string, output: string | null) {
    const bytes = (source.length + (output?.length ?? 0)) * 2;
    if (maxCacheEntries <= 0 || bytes > maxCacheBytes) return;
    while (cache.size >= maxCacheEntries || cacheBytes + bytes > maxCacheBytes) {
      const oldest = cache.entries().next().value;
      if (!oldest) break;
      cache.delete(oldest[0]);
      cacheBytes -= oldest[1].bytes;
    }
    cache.set(source, { output, bytes });
    cacheBytes += bytes;
  }

  async function drain() {
    if (running) return;
    running = true;
    for (let request = queue.shift(); request; request = queue.shift()) {
      let output: string | null = null;
      try {
        const rendered = await render(request.source);
        if (
          rendered !== null &&
          rendered.length > 0 &&
          rendered.length <=
            MERMAID_ASCII_LIMITS.canvasCells * 2 + MERMAID_ASCII_LIMITS.canvasDimension
        ) {
          output = rendered;
        }
        remember(request.source, output);
      } catch {
        output = null;
      }
      pending.delete(request.source);
      request.resolve(output);
    }
    running = false;
  }

  return {
    render(source: string): Promise<string | null> {
      if (source.length === 0 || source.length > MERMAID_ASCII_LIMITS.sourceChars) {
        return Promise.resolve(null);
      }
      const cached = cache.get(source);
      if (cached) {
        cache.delete(source);
        cache.set(source, cached);
        return Promise.resolve(cached.output);
      }
      const existing = pending.get(source);
      if (existing) return existing;
      if (pending.size >= maxPending) return Promise.resolve(null);
      const promise = new Promise<string | null>((resolve) => {
        queue.push({ source, resolve });
      });
      pending.set(source, promise);
      void drain();
      return promise;
    },
  };
}
