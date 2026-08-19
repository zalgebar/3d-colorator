// Slug ids — the stable handles that pieces, groups and share links reference.
//
// An id is derived from a name when the thing is created, and never moves on
// its own afterwards: renaming has to stay safe (that is the whole reason
// colors are referenced by id). Changing one is an explicit, warned action.

export const SLUG_RE = /^[a-z0-9_]+$/;

export function slugify(text, fallback = "item") {
  const base = String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || fallback;
}

export function uniqueId(base, taken) {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + "_" + n)) n++;
  return base + "_" + n;
}

export function slugId(name, taken, fallback = "item") {
  return uniqueId(slugify(name, fallback), taken);
}

// Returns null when acceptable, otherwise the reason it is not.
export function validateId(id, taken) {
  const value = String(id || "");
  if (!value) return "An id cannot be empty";
  if (!SLUG_RE.test(value)) return "Use lower-case letters, numbers and underscores only";
  if (taken.has(value)) return "That id is already taken";
  return null;
}

// Per-group accent, taken in order and repeating past the end of the set.
//
// An earlier version hashed the group id so a colour would survive reordering,
// but a hash cannot promise distinctness: with five colours, `controls` and a
// new group's default id `group` both landed on the same violet. Distinct
// colours are the point of the stripe, so position wins — the first five groups
// are always different, and only the sixth repeats.
export const GROUP_STRIPES = ["#37c8b4", "#ffb454", "#b980ff", "#ff7a9c", "#8fd14f"];

export function stripeAt(index) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0;
  return GROUP_STRIPES[i % GROUP_STRIPES.length];
}
