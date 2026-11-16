// rules_global.hide_amounts: shared helpers for the 22 and 33 hide-amount tests.
const AMOUNT = /\d\.\d{2}(?!\d)|GH₵\s*-?\d/;

// Every visible text piece and accessible name that still shows money (an amount like 8.00 or a
// GH₵ followed by a digit), skipping the subtrees `skip` excludes.
export function moneyPieces(tree, skip = () => false) {
  const out = [];
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node == null || typeof node !== "object") return;
    if (skip(node)) return;
    for (const name of ["aria-label", "title"]) if (typeof node.props?.[name] === "string") out.push(node.props[name]);
    if ("rendered" in node) return visit(node.rendered);
    for (const child of [node.props?.children].flat(Infinity)) {
      if (typeof child === "string" || typeof child === "number") out.push(String(child));
      else visit(child);
    }
  };
  visit(tree);
  return out.filter((piece) => AMOUNT.test(piece));
}

// What reaches the screen: host elements only (component props hold the raw amount, the page does not).
export function hostShape(node) {
  if (Array.isArray(node)) return node.map(hostShape);
  if (node == null || typeof node !== "object") return node;
  if ("rendered" in node) return hostShape(node.rendered);
  const { children, ...props } = node.props ?? {};
  return { type: String(node.type), props: Object.fromEntries(Object.entries(props).filter(([, value]) => typeof value !== "function")), children: hostShape(children) };
}
