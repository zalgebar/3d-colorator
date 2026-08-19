// Collections: one codebase, several storefronts.
//
// A collection is a filter plus a branding preset. `global` holds the defaults
// every collection inherits; a collection overrides only what differs, so
// SeedSigner Designer is this app pointed at the seedsigner category rather than
// a fork of it.

const URL_PATH = "collections.json";
const FALLBACK = {
  id: "default",
  name: "3D Colorator",
  tagline: "Color any 3D print",
  filter: null,
  about: {},
  submit: { enabled: false, shops: [] },
  customColors: { enabled: false },
};

// Three states: a collection that says nothing inherits global, an explicit
// false opts out, and an explicit true still requires global to be on.
function own(section) {
  return section && section.enabled !== undefined ? section.enabled : undefined;
}

export function resolveEnabled(globalSection, collectionSection) {
  const g = !!(globalSection && globalSection.enabled);
  const c = own(collectionSection);
  return g && (c === undefined ? true : c);
}

function mergeSection(globalSection, collectionSection, name) {
  const merged = { ...(globalSection || {}), ...(collectionSection || {}) };
  merged.enabled = resolveEnabled(globalSection, collectionSection);
  if (name === "submit" && !Array.isArray(merged.shops)) merged.shops = [];
  return merged;
}

export function normalizeCollections(raw) {
  const data = raw || {};
  const global = data.global || {};
  const entries = data.collections || {};
  const collections = {};

  Object.keys(entries).forEach((id) => {
    const c = entries[id] || {};
    collections[id] = {
      id,
      name: String(c.name || id),
      tagline: typeof c.tagline === "string" ? c.tagline : "",
      filter:
        c.filter && Array.isArray(c.filter.categories) && c.filter.categories.length
          ? { categories: c.filter.categories.map(String) }
          : null,
      about: { ...(global.about || {}), ...(c.about || {}) },
      submit: mergeSection(global.submit, c.submit, "submit"),
      customColors: mergeSection(global.customColors, c.customColors),
    };
  });

  if (!collections.default) collections.default = { ...FALLBACK };
  return { version: data.version || 1, collections };
}

// An unknown ?collection= must never render an empty app — fall back to default.
export function pickCollection(config, requested) {
  if (requested && config.collections[requested]) return config.collections[requested];
  if (requested) {
    console.warn("[collections] unknown collection '" + requested + "' — using default");
  }
  return config.collections.default;
}

// A print belongs to a collection if it carries ANY of its categories (D12).
// `filter: null` means every print.
export function printsFor(collection, prints) {
  if (!collection.filter) return prints;
  return prints.filter((p) => collection.filter.categories.some((c) => p.categories.includes(c)));
}

export async function loadCollections() {
  try {
    const res = await fetch(URL_PATH, { cache: "no-cache" });
    if (!res.ok) throw new Error(URL_PATH + " (" + res.status + ")");
    return normalizeCollections(await res.json());
  } catch (err) {
    // The app still has to run without a collections file.
    console.warn("[collections] " + err.message + " — using defaults");
    return normalizeCollections({ collections: { default: FALLBACK } });
  }
}
