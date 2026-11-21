import starterData from "../data/starter-items.json" with { type: "json" };

export const OTHER_CATEGORY_ID = starterData.other.id;
export const STARTER_CATEGORIES = Object.freeze([...starterData.categories, starterData.other]);

const categoriesById = new Map(STARTER_CATEGORIES.map((category) => [category.id, category]));
const key = (name) => name.trim().toLowerCase();

export function getPopularCategories() {
  return starterData.categories.filter(({ popular }) => popular === true);
}

export function getMoreCategoryGroups() {
  const groups = new Map();
  for (const category of starterData.categories) {
    if (category.popular === true) continue;
    if (!groups.has(category.group)) groups.set(category.group, []);
    groups.get(category.group).push(category);
  }
  return [...groups].map(([group, categories]) => ({ group, categories }));
}

export function isSomethingElseOnly(categoryIds) {
  return Array.isArray(categoryIds) && categoryIds.length > 0 &&
    categoryIds.every((id) => id === OTHER_CATEGORY_ID);
}

// Merges the picked categories, de-duplicating by case-insensitive name.
// A name that is core in any picked category is core.
export function mergeStarterItems(categoryIds) {
  if (!Array.isArray(categoryIds)) throw new TypeError("Choose at least one starter category.");
  const picked = categoryIds.map((id) => categoriesById.get(id)).filter(Boolean);
  const merged = new Map();
  for (const tier of ["core", "more"]) {
    for (const { name: category, [tier]: names } of picked) {
      for (const name of names) {
        const existing = merged.get(key(name));
        if (!existing) merged.set(key(name), { name, category, tier });
      }
    }
  }
  const items = [...merged.values()];
  return {
    core: items.filter(({ tier }) => tier === "core"),
    more: items.filter(({ tier }) => tier === "more")
  };
}

export const STARTER_GROUP_THRESHOLD = 30;

// Several categories whose combined core list is long are shown grouped (screen 52).
export function shouldGroupStarterList(categoryIds) {
  const picked = (categoryIds ?? []).filter((id) => id !== OTHER_CATEGORY_ID && categoriesById.has(id));
  return picked.length > 1 && mergeStarterItems(picked).core.length > STARTER_GROUP_THRESHOLD;
}

export function groupCoreItemsByCategory(categoryIds) {
  const { core } = mergeStarterItems(categoryIds);
  const groups = [];
  for (const item of core) {
    let group = groups.find(({ category }) => category === item.category);
    if (!group) groups.push(group = { category: item.category, items: [] });
    group.items.push(item);
  }
  return groups;
}

export function searchStarterCategories(query) {
  const text = String(query ?? "").trim().toLowerCase();
  return text ? STARTER_CATEGORIES.filter(({ name }) => name.toLowerCase().includes(text)) : [];
}

export function getStarterItemsForCategories(categoryIds) {
  const { core, more } = mergeStarterItems(categoryIds);
  return [...core, ...more].map(({ name, category }) => ({ name, category }));
}

export function getAllStarterItems() {
  const ids = STARTER_CATEGORIES.map(({ id }) => id);
  const { core, more } = mergeStarterItems(ids);
  return [...core, ...more];
}

export const STARTER_ITEMS = Object.freeze(getAllStarterItems().map(({ name }) => name));

export function searchStarterItems(query) {
  const text = String(query ?? "").trim().toLowerCase();
  const items = getAllStarterItems();
  return text ? items.filter(({ name }) => name.toLowerCase().includes(text)) : items;
}

// 36 opened from My items 39 (decided 20 Nov 2026). The chips: "All", the categories chosen at setup
// (saved when setup reached the starter list), then "More categories" for every other one. With no
// saved choice the popular categories take their place. "Something else" has no items and is never a chip.
export function starterChipCategories(savedIds) {
  const real = starterData.categories;
  const saved = Array.isArray(savedIds) ? savedIds.filter((id, index) => categoriesById.has(id) && id !== OTHER_CATEGORY_ID && savedIds.indexOf(id) === index) : [];
  const chosen = saved.length ? saved.map((id) => categoriesById.get(id)) : getPopularCategories();
  const chosenIds = new Set(chosen.map(({ id }) => id));
  return { chosen, more: real.filter(({ id }) => !chosenIds.has(id)) };
}

function uniqueByName(items) {
  const seen = new Set();
  return items.filter(({ name }) => !seen.has(key(name)) && seen.add(key(name)));
}

// The items one chip shows: "all" (the chosen categories first, then every other item), "more" (the
// categories under More categories) or one category id (its own core then more list).
export function starterItemsForChip(chip, { chosen, more }) {
  const ids = (categories) => categories.map(({ id }) => id);
  const ordered = (categoryIds) => {
    const { core, more: extra } = mergeStarterItems(categoryIds);
    return [...core, ...extra];
  };
  if (chip === "all") return uniqueByName([...ordered(ids(chosen)), ...ordered(ids(more))]);
  if (chip === "more") return ordered(ids(more));
  return categoriesById.has(chip) ? ordered([chip]) : [];
}

export function findStarterItem(name, category) {
  const text = typeof name === "string" ? key(name) : "";
  return STARTER_CATEGORIES.some((candidate) =>
    (!category || candidate.name === category) &&
    [...candidate.core, ...candidate.more].some((item) => key(item) === text)
  );
}
