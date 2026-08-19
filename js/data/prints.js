// Print catalog: the manifest index, individual print files, and STL geometry.
// Absorbs the old js/config.js.

import { STLLoader } from "three/addons/loaders/STLLoader.js";

const MANIFEST_URL = "prints/manifest.json";
const PRINT_DIR = "prints/";

const VEC3 = (v) => {
  if (!Array.isArray(v) || v.length !== 3) return [0, 0, 0];
  return v.map((n) => (typeof n === "number" && isFinite(n) ? n : 0));
};

export function normalizePiece(raw, fallbackId) {
  const def = raw || {};
  return {
    id: String(def.id || fallbackId || "piece"),
    label: String(def.label || def.id || fallbackId || "Piece"),
    file: String(def.file || ""),
    position: VEC3(def.position),
    rotation: VEC3(def.rotation),
    scale: VEC3(def.scale).map((n) => (n === 0 ? 1 : n)),
    centerOrigin: def.centerOrigin !== false,
    // a palette id; resolved against the Palette at render time
    defaultColor: def.defaultColor ? String(def.defaultColor) : null,
    // optional subset of palette ids; absent/empty means "offer all"
    palette: Array.isArray(def.palette) ? def.palette.map(String) : [],
    // An id read from a file is deliberate. Duplicates set this false so their
    // id can track the label until it is set by hand. Stripped on export.
    idFixed: true,
  };
}

// Color-only groups. Phase 4 builds the UI; normalized here so the field
// round-trips through export from the start.
export function normalizeLink(raw, i) {
  const l = raw || {};
  return {
    id: String(l.id || "link_" + i),
    label: typeof l.label === "string" ? l.label : "",
    members: Array.isArray(l.members) ? l.members.map(String) : [],
    collapsed: l.collapsed !== false,
    color: l.color ? String(l.color) : null,
    // An id read from a file is deliberate — never re-derive it from the label.
    // Newly created groups set this false so their id can track the name until
    // it is set by hand. Stripped on export.
    idFixed: true,
  };
}

export function normalizePrint(raw) {
  const c = raw || {};
  const id = String(c.id || "print");
  const pieces = Array.isArray(c.pieces)
    ? c.pieces.map((p, i) => normalizePiece(p, "piece_" + i))
    : [];
  const pieceIds = new Set(pieces.map((p) => p.id));
  const claimed = new Set();
  const links = (Array.isArray(c.links) ? c.links : [])
    .map(normalizeLink)
    .map((l) => ({ ...l, members: l.members.filter((m) => pieceIds.has(m)) }))
    // a piece belongs to at most one group; a group needs 2+ members
    .map((l) => {
      const members = l.members.filter((m) => !claimed.has(m));
      members.forEach((m) => claimed.add(m));
      return { ...l, members };
    })
    .filter((l) => l.members.length >= 2);

  return {
    id,
    name: String(c.name || id),
    description: String(c.description || ""),
    categories: Array.isArray(c.categories) ? c.categories.map(String) : [],
    axes: c.axes && c.axes.up ? { up: String(c.axes.up) } : { up: "z" },
    camera: c.camera || null,
    links,
    pieces,
  };
}

export function transformToArray(mesh) {
  return {
    position: [mesh.position.x, mesh.position.y, mesh.position.z],
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
  };
}

// Rebuilds the print file from the live scene, so a design-mode session can be
// downloaded and committed back into the repo.
export function buildExportObject(print, records) {
  return {
    id: print.id,
    name: print.name,
    description: print.description,
    categories: print.categories,
    axes: print.axes,
    camera: print.camera,
    // strip UI-only bookkeeping such as idFixed
    links: print.links.map((l) => ({
      id: l.id,
      label: l.label,
      members: l.members,
      collapsed: l.collapsed,
      color: l.color,
    })),
    pieces: print.pieces.map((def) => {
      const rec = records.get(def.id);
      const t = rec ? transformToArray(rec.mesh) : def;
      const piece = {
        // idFixed is UI-only bookkeeping and never written out
        id: def.id,
        label: def.label,
        file: def.file,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        centerOrigin: def.centerOrigin !== false,
        // A piece may currently be showing an off-palette color (an imported
        // order placed before the catalog changed). That is a viewing state,
        // not a catalog edit, so the authored default is written out instead.
        defaultColor:
          rec && typeof rec.color === "string" ? rec.color : def.defaultColor,
      };
      if (def.palette && def.palette.length) piece.palette = def.palette;
      return piece;
    }),
  };
}

export async function loadManifest() {
  const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load " + MANIFEST_URL + " (" + res.status + ")");
  const raw = await res.json();
  const entries = Array.isArray(raw.prints) ? raw.prints : [];
  return {
    version: raw.version || "0",
    prints: entries.map((e, i) => ({
      id: String((e && e.id) || "print_" + i),
      name: String((e && e.name) || (e && e.id) || "Print"),
      categories: Array.isArray(e && e.categories) ? e.categories.map(String) : [],
      // Optional. A print without one gets a name-only tile in the picker.
      thumbnail: e && e.thumbnail ? String(e.thumbnail) : null,
    })),
  };
}

// Fetched on selection, not at startup — the manifest alone drives the sidebar.
export async function loadPrint(id) {
  const url = PRINT_DIR + encodeURIComponent(id) + ".json";
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load print '" + id + "' (" + res.status + ")");
  return normalizePrint(await res.json());
}

// Parsed STL geometry, keyed by the transforms baked into it. Several pieces can
// point at one STL (duplicated instances), so this keeps that at one fetch and
// one parse. Scoped to the active print; dispose() on switch.
export class GeometryCache {
  constructor() {
    this.loader = new STLLoader();
    this.map = new Map();
  }

  key(file, up, centerOrigin) {
    return file + "|" + up + "|" + (centerOrigin ? 1 : 0);
  }

  async get(file, { up = "z", centerOrigin = true } = {}) {
    const k = this.key(file, up, centerOrigin);
    if (this.map.has(k)) return this.map.get(k);
    const promise = this.loader.loadAsync(file).then((geometry) => {
      if (up === "z") geometry.rotateX(-Math.PI / 2);
      geometry.computeVertexNormals();
      if (centerOrigin) geometry.center();
      geometry.computeBoundingBox();
      return geometry;
    });
    this.map.set(k, promise);
    return promise;
  }

  async dispose() {
    const pending = [...this.map.values()];
    this.map.clear();
    for (const p of pending) {
      try {
        (await p).dispose();
      } catch {
        /* a failed load has nothing to dispose */
      }
    }
  }
}
