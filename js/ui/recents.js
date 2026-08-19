// The prints this browser looked at last, most recent first.
//
// Kept per browser rather than in a file: it is a convenience for whoever is
// sitting here, not part of the catalog.

const KEY = "colorator.recentPrints";
// One more than the three shown: the current print occupies a slot in history
// but is named separately in the sidebar, so it is filtered out of the list.
const LIMIT = 4;

export function readRecents() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function rememberPrint(id) {
  if (!id) return readRecents();
  const next = [id, ...readRecents().filter((x) => x !== id)].slice(0, LIMIT);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private browsing — recents just won't persist */
  }
  return next;
}

// Only prints the active collection actually lists; a recent from another
// storefront has no business showing here.
export function visibleRecents(available) {
  const ids = new Set(available.map((p) => p.id));
  return readRecents()
    .filter((id) => ids.has(id))
    .map((id) => available.find((p) => p.id === id));
}
