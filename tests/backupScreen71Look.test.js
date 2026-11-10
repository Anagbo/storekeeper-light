import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { db } from "../src/db/db.js";
import { loadJsx, render, textOf, walk } from "./helpers/renderJsx.js";

after(async () => {
  db.close();
  await db.delete();
});

async function mount() {
  const { default: BackupRestore } = await loadJsx("src/pos/BackupRestore.jsx");
  return render({ type: BackupRestore, props: { onBack: () => {} } });
}
const all = (tree, test) => [...walk(tree)].filter((node) => node.props && test(node));
const cls = (node) => String(node.props.className ?? "");
const button = (tree, label) => all(tree, (n) => n.type === "button" && textOf(n).trim() === label)[0];
const section = (tree, id) => all(tree, (n) => n.type === "section" && n.props["aria-labelledby"] === id)[0];
const icons = (node) => all(node, (n) => n.type === "svg");
const iconNamed = (node, name) => all(node, (n) => n.type === "svg" && n.props["data-icon"] === name)[0];

test("71 look: intro line, exact card texts, in order", async () => {
  const text = textOf((await mount()).tree);
  const order = [
    "Backup and restore",
    "Keep a copy of your sales, debts and items. It works without internet.",
    "Save a backup",
    "Saves one file on this phone with all your records.",
    "Download backup",
    "Restore from a backup",
    "Adds the records from a backup file to this phone. Matching records are updated. Nothing here is deleted.",
    "Choose backup file"
  ];
  let at = -1;
  for (const piece of order) {
    const next = text.indexOf(piece, at + 1);
    assert.ok(next > at, `missing or out of order: ${piece}`);
    at = next;
  }
});

test("71 look: a green download icon and a green upload icon sit before the card headings", async () => {
  const { tree } = await mount();
  for (const [id, name] of [["backup-save-title", "download"], ["backup-restore-title", "upload"]]) {
    const card = section(tree, id);
    const heading = all(card, (n) => n.type === "h2")[0];
    const icon = iconNamed(card, name);
    assert.ok(icon, `${name} icon present`);
    assert.equal(icon.props["aria-hidden"], "true");
    assert.match(cls(icon), /text-\[#03543F\]|text-emerald-900/);
    const nodes = [...walk(card)];
    assert.ok(nodes.indexOf(icon) < nodes.indexOf(heading), "icon comes before the heading");
  }
});

test("71 look: both buttons are 56px, bold 800 18px, with the right colours and accessible names", async () => {
  const { tree } = await mount();
  const download = button(tree, "Download backup");
  const choose = button(tree, "Choose backup file");
  assert.ok(download && choose, "accessible names Download backup and Choose backup file");
  for (const item of [download, choose]) {
    assert.match(cls(item), /\bh-14\b/);
    assert.match(cls(item), /font-extrabold/);
    assert.match(cls(item), /text-\[18px\]/);
    assert.doesNotMatch(cls(item), /min-h-/);
  }
  assert.match(cls(download), /bg-\[#03543F\]/);
  assert.match(cls(download), /text-white/);
  assert.match(cls(choose), /bg-white/);
  assert.match(cls(choose), /border-2/);
  assert.match(cls(choose), /border-\[#0F172A\]/);
  assert.match(cls(choose), /text-\[#0F172A\]/);
  assert.doesNotMatch(cls(choose), /(bg|border|text)-emerald/);
  for (const item of [download, choose]) for (const svg of icons(item)) assert.equal(svg.props["aria-hidden"], "true");
});

test("71 look: card border, corners, padding, heading and text sizes, gap between cards", async () => {
  const { tree } = await mount();
  for (const id of ["backup-save-title", "backup-restore-title"]) {
    const card = section(tree, id);
    assert.match(cls(card), /border-2/);
    assert.match(cls(card), /border-\[#CBD5E1\]/);
    assert.match(cls(card), /rounded-\[18px\]/);
    assert.match(cls(card), /\bp-4\b/);
    const heading = all(card, (n) => n.type === "h2")[0];
    assert.match(cls(heading), /text-\[19px\]/);
    assert.match(cls(heading), /\bfont-bold\b/);
    assert.match(cls(all(card, (n) => n.type === "p")[0]), /text-base[^"]*text-\[#475569\]|text-\[#475569\][^"]*text-base/);
  }
  const wrapper = all(tree, (n) => /gap-\[14px\]/.test(cls(n)));
  assert.ok(wrapper.length >= 1, "14px gap around the two cards");
});
