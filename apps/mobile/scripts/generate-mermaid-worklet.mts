import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { build } from "vite-plus";

const mobileRoot = NodePath.resolve(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), "..");

export async function generateMermaidWorklet(
  outputRoot = NodePath.join(mobileRoot, ".generated/mermaid-worklet"),
) {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      minify: true,
      lib: {
        entry: NodeURL.fileURLToPath(import.meta.resolve("@supaterm/mermaid-ascii")),
        name: "SupatermMermaidAscii",
        formats: ["iife"],
      },
    },
  });
  const bundles = Array.isArray(result) ? result : [result];
  const chunks = bundles.flatMap((bundle) =>
    "output" in bundle ? bundle.output.filter((output) => output.type === "chunk") : [],
  );
  const chunk = chunks[0];
  if (!chunk || chunks.length !== 1 || chunk.imports.length || chunk.dynamicImports.length) {
    throw new Error("Mermaid worklet build must emit one self-contained script.");
  }
  const code = `module.exports = function renderMermaidWorklet(source) {
"worklet";
${chunk.code}
try {
  return SupatermMermaidAscii.renderMermaidAscii(source, { useAscii: true });
} catch {
  return null;
}
};
`;
  await NodeFSP.mkdir(outputRoot, { recursive: true });
  for (const [name, contents] of [
    ["index.js", code],
    ["package.json", '{"main":"index.js"}\n'],
  ] as const) {
    const destination = NodePath.join(outputRoot, name);
    const previous = await NodeFSP.readFile(destination, "utf8").catch(() => null);
    if (previous !== contents) await NodeFSP.writeFile(destination, contents);
  }
}
