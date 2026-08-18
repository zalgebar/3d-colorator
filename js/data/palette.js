// The app-wide color catalog. Everything references colors by `id` — pieces,
// share links, submissions — so renaming or re-mixing a color never breaks a
// reference. See docs/redesign/01-data-model.md#palettejson

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
// 01-data-model.md#reserved-for-the-future-not-implemented

export function isCustom(chosen) {
  return !!chosen && typeof chosen === "object" && HEX_RE.test(chosen.custom || "");
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
  // catalog, in catalog order. 01-data-model.md#piece-color-offering-d5
  offeredIds(piece) {
    const subset = Array.isArray(piece && piece.palette)
      ? piece.palette.filter((id) => this.has(id))
      : [];
    return subset.length ? subset : this.ids;
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
      return { id: null, name: chosen.custom, hex: chosen.custom.toLowerCase(), opacity: 1, custom: true };
    }
    const c = this.byId(chosen);
    if (!c) return { id: null, name: String(chosen), hex: FALLBACK_HEX, opacity: 1, custom: false };
    return { ...c, custom: false };
  }

  // three.js material properties for a chosen color.
  //
  // `depthWrite` stays true by default: a lone translucent part writing depth
  // looks right, and disabling it lets a part show through itself. The caller
  // flips it off only when translucent parts actually overlap — see
  // syncTransparencySorting() in app.js. 03-ui-behavior.md#opacity-rendering
  toMaterial(chosen) {
    const c = this.resolve(chosen);
    return {
      color: c.hex,
      transparent: c.opacity < 1,
      opacity: c.opacity,
      depthWrite: true,
    };
  }
}

export async function loadPalette(url = "palette.json") {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load " + url + " (" + res.status + ")");
  return new Palette(await res.json());
}
