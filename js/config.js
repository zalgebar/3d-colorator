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
    scale: VEC3(def.scale).map((n, i) => (n === 0 ? 1 : n)),
    centerOrigin: def.centerOrigin !== false,
    defaultColor: /^#[0-9a-fA-F]{6}$/.test(def.defaultColor || "")
      ? def.defaultColor
      : /^#[0-9a-fA-F]{6}$/.test(def.color || "")
        ? def.color
        : "#cccccc",
    colors: Array.isArray(def.colors)
      ? def.colors.filter((c) => /^#[0-9a-fA-F]{6}$/.test(c))
      : [],
  };
}

export function normalizeConfig(raw) {
  const c = raw || {};
  const id = String(c.id || "enclosure");
  return {
    id,
    name: String(c.name || id),
    description: String(c.description || ""),
    axes: c.axes && c.axes.up ? { up: String(c.axes.up) } : { up: "z" },
    camera: c.camera || null,
    pieces: Array.isArray(c.pieces) ? c.pieces.map((p, i) => normalizePiece(p, `piece_${i}`)) : [],
  };
}

export function transformToArray(mesh) {
  return {
    position: [mesh.position.x, mesh.position.y, mesh.position.z],
    rotation: [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z],
    scale: [mesh.scale.x, mesh.scale.y, mesh.scale.z],
  };
}

export function buildExportObject(config, records) {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    axes: config.axes,
    camera: config.camera,
    pieces: config.pieces.map((def) => {
      const rec = records.get(def.id);
      const t = rec ? transformToArray(rec.mesh) : def;
      return {
        id: def.id,
        label: def.label,
        file: def.file,
        position: t.position,
        rotation: t.rotation,
        scale: t.scale,
        centerOrigin: def.centerOrigin !== false,
        defaultColor: rec ? rec.color : def.defaultColor,
        colors: def.colors,
      };
    }),
  };
}
