import { createDiagramRenderer } from "@supaterm/client-runtime/diagram-rendering";
import renderMermaidWorklet from "@supaterm/mobile-mermaid-worklet";
import {
  createWorkletRuntime,
  runOnRuntimeAsync,
  type WorkletRuntime,
} from "react-native-worklets";

let runtime: WorkletRuntime | undefined;

const renderer = createDiagramRenderer(async (source) => {
  runtime ??= createWorkletRuntime({
    name: "mermaid-ascii",
    enableEventLoop: false,
    enableNetworking: false,
  });
  return runOnRuntimeAsync(runtime, renderMermaidWorklet, source);
});

export const renderMermaidDiagram = renderer.render;
