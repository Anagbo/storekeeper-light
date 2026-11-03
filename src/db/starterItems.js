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

export function findStarterItem(name, category) {
  const text = typeof name === "string" ? key(name) : "";
  return STARTER_CATEGORIES.some((candidate) =>
    (!category || candidate.name === category) &&
    [...candidate.core, ...candidate.more].some((item) => key(item) === text)
  );
}
