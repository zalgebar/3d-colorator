// Share links.
//
// A link carries palette **ids**, never hex, so it can only ever express colors
// the shop actually offers, and names/opacity travel for free on the color
// object.
//
// What a link cannot carry is a snapshot: opening one resolves the ids against
// whatever the catalog says *now*. So a color that was renamed or re-mixed under
// the same id applies silently and correctly, while a color that was deleted or
// withdrawn from a piece is detectable and has to be reconciled.

import { parseChosen, isCustom } from "../data/palette.js";

const RESERVED = new Set(["print", "collection", "design"]);

// Collapsed groups are one item to the visitor, so they travel as one key.
// Separate groups list their members, which reads better and resolves the same.
export function buildShareLink({ print, links, records, origin = location }) {
  const params = new URLSearchParams();
  const collection = new URLSearchParams(origin.search).get("collection");
  if (collection) params.set("collection", collection);
  params.set("print", print.id);

  const done = new Set();
  print.pieces.forEach((def) => {
    if (done.has(def.id)) return;
    const group = links.find((l) => l.members.includes(def.id));
    if (group) {
      group.members.forEach((m) => done.add(m));
      if (group.collapsed) {
        params.set(group.id, group.color);
      } else {
        group.members.forEach((m) => params.set(m, group.color));
      }
      return;
    }
    done.add(def.id);
    const rec = records.get(def.id);
    if (rec) params.set(def.id, rec.color);
  });

  return origin.origin + origin.pathname + "?" + params.toString();
}

export function parseShareLink(search) {
  const params = new URLSearchParams(search);
  const colors = [];
  params.forEach((value, key) => {
    if (RESERVED.has(key)) return;
    colors.push({ key, token: value });
  });
  return {
    collection: params.get("collection"),
    print: params.get("print"),
    colors,
  };
}

// Sorts every shared color into apply-now or needs-a-decision.
//
//   applied    - resolves and is offered where it landed
//   unoffered  - the color exists, but not for that piece; we know its hex, so
//                the nearest offered color can be suggested
//   unknown    - not in the catalog at all; detectable, but there is nothing to
//                match against, so the choice is the user's
//
// A `~rrggbb` custom request parses but is treated as unknown until the paid
// feature ships, so a future link degrades instead of hard-failing.
export function classifyShared({ shared, palette, resolveTarget }) {
  const applied = new Map();
  const problems = [];

  shared.forEach(({ key, token }) => {
    const target = resolveTarget(key);
    if (!target) return; // a key for a piece or group this print does not have

    const chosen = parseChosen(token);
    const custom = isCustom(chosen);
    const id = custom ? null : chosen;

    if (!custom && palette.has(id) && target.offered.includes(id)) {
      applied.set(key, id);
      return;
    }

    const known = !custom && palette.has(id);
    problems.push({
      key,
      target,
      requested: token,
      requestedName: known ? palette.nameOf(id) : null,
      requestedHex: known ? palette.hexOf(id) : null,
      kind: known ? "unoffered" : "unknown",
      // Only a color we can still see has a meaningful "nearest".
      chosen: known
        ? palette.nearestId(palette.hexOf(id), target.offered) || target.current
        : target.offered.includes(target.current)
          ? target.current
          : target.offered[0],
    });
  });

  return { applied, problems };
}
