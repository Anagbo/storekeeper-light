// Loads a real .jsx screen for a test: esbuild compiles it (and its imports) with React and
// dexie-react-hooks swapped for tests/helpers/reactShim.js. Nothing is written to disk.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const shimPath = fileURLToPath(new URL("./reactShim.js", import.meta.url));
const cache = new Map();

// `env` sets import.meta.env for the compiled screen (for example a feature flag).
export async function loadJsx(repoPath, env = {}) {
  const cacheKey = `${repoPath}|${JSON.stringify(env)}`;
  if (!cache.has(cacheKey)) {
    cache.set(cacheKey, (async () => {
      const result = await build({
        entryPoints: [fileURLToPath(new URL(`../../${repoPath}`, import.meta.url))],
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        jsx: "automatic",
        define: { "import.meta.env": JSON.stringify(env) },
        logLevel: "silent",
        plugins: [{
          name: "react-shim",
          setup(context) {
            context.onResolve({ filter: /^(react|react\/jsx-runtime|react\/jsx-dev-runtime|react-dom|dexie-react-hooks)$/ }, () => ({ path: shimPath }));
          }
        }]
      });
      const code = result.outputFiles[0].text;
      return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
    })());
  }
  return cache.get(cacheKey);
}

export { flushEffects, render, setLiveQuery } from "./reactShim.js";

// Every node in a rendered tree, depth first.
export function* walk(node) {
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  if (!node || typeof node !== "object") return;
  yield node;
  if ("rendered" in node) yield* walk(node.rendered);
  else yield* walk(node.props?.children);
}

// The visible text under a node.
export function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if ("rendered" in node) return textOf(node.rendered);
  return textOf(node.props?.children);
}

export function findComponent(tree, name) {
  for (const node of walk(tree)) if (typeof node.type === "function" && node.type.name === name) return node;
  return null;
}

// The innermost button (host element or Pos*Button component) whose text includes `label`.
export function findButton(tree, label) {
  let found = null;
  for (const node of walk(tree)) {
    const isButton = node.type === "button" || (typeof node.type === "function" && /Button$/.test(node.type.name));
    if (isButton && textOf(node).includes(label)) found = node;
  }
  return found;
}