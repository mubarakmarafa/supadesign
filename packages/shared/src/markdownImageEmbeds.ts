import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import { parseFileUrlHref } from "./fileLinks.ts";
import { safeDecodeURIComponent } from "./markdownLinks.ts";
import { isUncPath, isWindowsAbsolutePath, stripSlashPrefixedWindowsDrive } from "./path.ts";
import { remarkKeepWindowsPathDestinations } from "./markdownWindowsPaths.ts";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkKeepWindowsPathDestinations);

interface ImageNode {
  readonly type: string;
  readonly url?: string;
  readonly identifier?: string;
  readonly children?: ReadonlyArray<ImageNode>;
}

function imagePathKey(value: string): string {
  const path = stripSlashPrefixedWindowsDrive(value);
  return isWindowsAbsolutePath(path) ? path.replaceAll("\\", "/").toLowerCase() : path;
}

function imageDestination(path: string): string {
  const normalized = isWindowsAbsolutePath(path) ? path.replaceAll("\\", "/") : path;
  const destination = isUncPath(path) ? `file:${normalized}` : normalized;
  return encodeURI(destination).replace(/[?#&]/g, encodeURIComponent);
}

export function appendMissingImageEmbeds(text: string, paths: Iterable<string>): string {
  const embedded = new Set<string>();
  if (text.includes("![")) {
    const tree = parser.parse(text);
    const definitions = new Map<string, string>();
    const images: ImageNode[] = [];
    const visit = (node: ImageNode) => {
      if (node.type === "definition" && node.identifier && node.url) {
        if (!definitions.has(node.identifier)) definitions.set(node.identifier, node.url);
      } else if (node.type === "image" || node.type === "imageReference") {
        images.push(node);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
    for (const image of images) {
      const href = image.url ?? definitions.get(image.identifier ?? "");
      if (href) {
        embedded.add(imagePathKey(safeDecodeURIComponent(parseFileUrlHref(href)?.path ?? href)));
      }
    }
  }
  const missing: string[] = [];
  for (const path of paths) {
    const key = imagePathKey(path);
    if (embedded.has(key)) continue;
    embedded.add(key);
    missing.push(`![](<${imageDestination(path)}>)`);
  }
  return [text, ...missing].filter((part) => part.length > 0).join("\n\n");
}
