// The app-wide color catalog. Everything references colors by `id` — pieces,
// share links, submissions — so renaming or re-mixing a color never breaks a
// reference.

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const FALLBACK_HEX = "#cccccc";

function normalizeColor(raw, i) {
  const c = raw || {};
  const id = String(c.id || "color_" + i);
  const opacity = typeof c.opacity === "number" ? Math.min(1, Math.max(0, c.opacity)) : 1;
  return {
    id,
    name: String(c.name || id),
    hex: HEX_RE.test(c.hex || "") ? String(c.hex).toLowerCase() : FALLBACK_HEX,
    opacity,
  };
}

export function normalizePalette(raw) {
  const p = raw || {};
  const seen = new Set();
  const colors = [];
  (Array.isArray(p.colors) ? p.colors : []).forEach((c, i) => {
    const color = normalizeColor(c, i);
    if (seen.has(color.id)) return; // ids are unique; first wins
    seen.add(color.id);
    colors.push(color);
  });
  return { version: p.version || 1, colors };
}

// A piece's chosen color is a small union: a palette id, or an off-palette
// request. Only ids are produced today — `{ custom }` is reserved for the paid
// custom-color feature, but everything downstream already resolves it.
//   type Chosen = string | { custom: "#rrggbb" }

export function isCustom(chosen) {
  return !!chosen && typeof chosen === "object" && HEX_RE.test(chosen.custom || "");
}

// An off-palette color that carries its own values. Used for a paid custom
// request, and for showing an order exactly as it was placed when the catalog
// has moved on since.
export function customColor(hex, { name, opacity } = {}) {
  return {
    custom: String(hex).toLowerCase(),
    name: name || String(hex).toLowerCase(),
    opacity: typeof opacity === "number" ? Math.min(1, Math.max(0, opacity)) : 1,
  };
}

// How a chosen color is written into a share link: ids bare, customs `~`-prefixed.
export function chosenKey(chosen) {
  if (isCustom(chosen)) return "~" + chosen.custom.slice(1).toLowerCase();
  return String(chosen || "");
}

export function parseChosen(token) {
  const t = String(token || "");
  if (t.startsWith("~")) {
    const hex = "#" + t.slice(1).toLowerCase();
    return HEX_RE.test(hex) ? { custom: hex } : null;
  }
  return t || null;
}

export function isTranslucent(color) {
  return !!color && color.opacity < 1;
}

export class Palette {
  constructor(raw) {
    const data = normalizePalette(raw);
    this.version = data.version;
    this.colors = data.colors;
    this._byId = new Map(this.colors.map((c) => [c.id, c]));
  }

  get ids() {
    return this.colors.map((c) => c.id);
  }

  has(id) {
    return this._byId.has(id);
  }

  byId(id) {
    return this._byId.get(id) || null;
  }

  hexOf(id) {
    const c = this.byId(id);
    return c ? c.hex : FALLBACK_HEX;
  }

  nameOf(id) {
    const c = this.byId(id);
    return c ? c.name : String(id);
  }

  // Which colors a piece offers: an absent or empty `palette` means the whole
  // catalog, in catalog order.
  offeredIds(piece) {
    const subset = Array.isArray(piece && piece.palette)
      ? piece.palette.filter((id) => this.has(id))
      : [];
    return subset.length ? subset : this.ids;
  }

  // Colors every one of these pieces can be — a link group can only show a
  // color all of its members offer. Falls back to the first member's offering
  // if the subsets have nothing in common, so a group is never left with none.
  sharedOfferedIds(pieces) {
    if (!pieces.length) return [];
    const shared = pieces
      .slice(1)
      .reduce(
        (acc, piece) => acc.filter((id) => this.offeredIds(piece).includes(id)),
        this.offeredIds(pieces[0])
      );
    if (shared.length) return shared;
    console.warn("[palette] linked pieces share no offered color; using the first member's");
    return this.offeredIds(pieces[0]);
  }

  // Closest candidate to a hex, by plain RGB distance. Used to suggest a
  // replacement when a shared color is not offered for the piece it lands on.
  nearestId(hex, candidateIds) {
    const rgb = (h) => {
      const n = parseInt(String(h).replace("#", ""), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const target = rgb(hex);
    let best = candidateIds[0] || null;
    let bestD = Infinity;
    candidateIds.forEach((id) => {
      const c = this.byId(id);
      if (!c) return;
      const p = rgb(c.hex);
      const d = Math.hypot(target[0] - p[0], target[1] - p[1], target[2] - p[2]);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    });
    return best;
  }

  // A piece's starting color, repaired if it points outside its own offering.
  defaultColorOf(piece) {
    const offered = this.offeredIds(piece);
    const want = piece && piece.defaultColor;
    if (want && offered.includes(want)) return want;
    if (want) {
      console.warn(
        "[palette] piece '" + (piece.id || "?") + "' defaultColor '" + want +
          "' is not offered; falling back to '" + offered[0] + "'"
      );
    }
    return offered[0] || null;
  }

  // Resolve either arm of the Chosen union to something renderable. A custom
  // color has no catalog entry, so it carries its own hex and is always opaque.
  resolve(chosen) {
    if (isCustom(chosen)) {
      return {
        id: null,
        name: chosen.name || chosen.custom,
        hex: chosen.custom.toLowerCase(),
        opacity: typeof chosen.opacity === "number" ? chosen.opacity : 1,
        custom: true,
      };
    }
    const c = this.byId(chosen);
    if (!c) return { id: null, name: String(chosen), hex: FALLBACK_HEX, opacity: 1, custom: false };
    return { ...c, custom: false };
  }

  // three.js material properties for a chosen color.
  //
  // A translucent piece must show its own far side — the internal ribs, bosses
  // and walls you would really see through translucent filament — so it cannot
  // write depth, or a near surface would reject everything behind it.
  //
  // Alpha blending is order-dependent, and triangles within a mesh are drawn in
  // buffer order, so the far wall is not reliably composited under the near one.
  // `twoPass` tells app.js to draw the piece as a back-face pass followed by a
  // front-face pass, which puts those surfaces in the right order.
  toMaterial(chosen) {
    const c = this.resolve(chosen);
    const translucent = c.opacity < 1;
    return {
      color: c.hex,
      transparent: translucent,
      opacity: c.opacity,
      depthWrite: !translucent,
      twoPass: translucent,
    };
  }
}

export async function loadPalette(url = "palette.json") {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load " + url + " (" + res.status + ")");
  return new Palette(await res.json());
}
