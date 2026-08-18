// Bootstrap and wiring. Scene lives in scene.js, data loading in data/, and the
// sidebar widgets in ui/ — this file owns app state and connects them.

import * as THREE from "three";
import { Viewer } from "./scene.js";
import { DesignEditor } from "./editor.js";
import { loadPalette } from "./data/palette.js";
import {
  loadManifest,
  loadPrint,
  normalizePrint,
  buildExportObject,
  GeometryCache,
} from "./data/prints.js";
import { PieceList } from "./ui/pieceList.js";
import { PaletteEditor } from "./ui/paletteEditor.js";
import { DesignIO } from "./ui/submit.js";
import { initFeedback, toast, showLoading } from "./ui/toast.js";

const isOwner = new URLSearchParams(window.location.search).has("design");

const state = {
  manifest: null,
  palette: null,
  print: null,
  records: new Map(),
  geometry: null,
  selectedId: null,
  designOn: false,
  dirty: false,
};

const els = {};
[
  "print-list", "print-desc", "piece-list", "editor-panel", "selected-name",
  "transform-modes", "transform-inputs", "btn-reset-transform", "btn-reset-all",
  "btn-frame", "btn-origin", "btn-axes", "btn-grid", "btn-screenshot",
  "btn-copy", "btn-download", "btn-import", "btn-download-design", "btn-import-design",
  "btn-submit", "import-dialog", "import-text", "btn-import-apply", "btn-import-cancel",
  "design-import-dialog", "design-file", "design-import-text", "btn-design-import-apply",
  "btn-design-import-cancel", "submit-dialog", "order-id", "identity-mode",
  "identity-extension", "extension-pubkey", "identity-nsec", "nsec-input", "nsec-remember",
  "identity-onetime", "onetime-pubkey", "submit-preview", "submit-status",
  "btn-submit-send", "btn-submit-cancel", "loading", "toast", "viewport", "about-version",
  "palette-section", "palette-head", "palette-count", "palette-list", "btn-add-color",
  "btn-copy-palette", "btn-download-palette", "color-delete-dialog", "color-delete-msg",
  "color-delete-uses", "btn-color-delete-cancel", "btn-color-delete-confirm",
].forEach((id) => {
  els[id.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = document.getElementById(id);
});

let viewer, editor, pieceList, designIO, paletteEditor;
let gridVisible = isOwner;
let axesVisible = isOwner;

const markDirty = () => (state.dirty = true);

function init() {
  initFeedback({ toast: els.toast, loading: els.loading });

  viewer = new Viewer(els.viewport, { gridVisible, axesVisible });
  els.btnGrid.classList.toggle("active", gridVisible);
  els.btnAxes.classList.toggle("active", axesVisible);

  editor = new DesignEditor({
    scene: viewer.scene,
    camera: viewer.camera,
    dom: els.viewport,
    controls: viewer.controls,
    onSelect: onSelectPiece,
    onTransform: onTransformChange,
  });

  pieceList = new PieceList(els.pieceList, {
    onSelect: (id) => editor.select(id),
    onColorChange: setPieceColor,
    onOfferingChange: (pieceId) => {
      repairPieceDefault(pieceId);
      rebuildPieceList();
      markDirty();
    },
    onVisibilityChange: (id, visible) => {
      if (!visible && state.selectedId === id) {
        editor.detach();
        state.selectedId = null;
        pieceList.updateSelection(null);
      }
      if (!visible) viewer.frameView();
    },
  });

  paletteEditor = new PaletteEditor(els, {
    getPalette: () => state.palette,
    // A hex/opacity edit must reach every piece already using that color.
    onColorChanged: (color, opts) => {
      state.records.forEach((rec) => {
        if (rec.color === color.id) applyColor(rec, rec.color);
      });
      pieceList.repaintColors();
      if (!opts || !opts.nameOnly) markDirty();
      else markDirty();
    },
    onPaletteStructureChanged: () => {
      rebuildPieceList();
      markDirty();
    },
    usageOf: (colorId) => {
      if (!state.print) return [];
      return state.print.pieces.filter(
        (def) => state.palette.offeredIds(def).includes(colorId) || def.defaultColor === colorId
      );
    },
    removeColor: (colorId) => removeColorEverywhere(colorId),
  });

  designIO = new DesignIO(els, {
    getPrint: () => state.print,
    getRecords: () => state.records,
    getPalette: () => state.palette,
    setPieceColor: (id, colorId) => setPieceColor(id, colorId),
  });

  wireUI();
  applyOwnerGating(isOwner);
  loadCatalog();
  viewer.start();
}

function applyOwnerGating(owner) {
  document.querySelectorAll("[data-owner-only]").forEach((el) => el.classList.toggle("hidden", !owner));
  document.querySelectorAll("[data-public-only]").forEach((el) => el.classList.toggle("hidden", owner));
}

function wireUI() {
  els.btnFrame.addEventListener("click", () => viewer.frameView());
  els.btnOrigin.addEventListener("click", () => {
    viewer.centerOnOrigin();
    toast("Centered on origin");
  });
  els.btnAxes.addEventListener("click", () => {
    axesVisible = !axesVisible;
    viewer.setAxesVisible(axesVisible);
    els.btnAxes.classList.toggle("active", axesVisible);
    toast(axesVisible ? "Axis marker on" : "Axis marker off");
  });
  els.btnGrid.addEventListener("click", () => {
    gridVisible = !gridVisible;
    viewer.setGridVisible(gridVisible);
    els.btnGrid.classList.toggle("active", gridVisible);
    toast(gridVisible ? "Grid on" : "Grid off");
  });

  els.btnScreenshot.addEventListener("click", () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    viewer.screenshot("design-" + state.print.id + "-" + stamp + ".png", (name) => {
      toast(name ? "Saved " + name : "Could not capture image", !name);
    });
  });

  els.btnDownloadDesign.addEventListener("click", () => {
    if (designIO.download()) state.dirty = false;
  });
  els.btnImportDesign.addEventListener("click", () => {
    els.designImportText.value = "";
    els.designFile.value = "";
    els.designImportDialog.showModal();
  });
  els.designFile.addEventListener("change", async () => {
    const file = els.designFile.files[0];
    if (!file) return;
    const text = await file.text();
    els.designImportDialog.close();
    designIO.applyImported(text);
  });
  els.btnDesignImportApply.addEventListener("click", () => {
    els.designImportDialog.close();
    designIO.applyImported(els.designImportText.value);
  });
  els.btnDesignImportCancel.addEventListener("click", () => els.designImportDialog.close());

  els.btnSubmit.addEventListener("click", () => designIO.openDialog());
  els.orderId.addEventListener("input", () => designIO.updatePreview());
  els.identityMode.addEventListener("change", () => designIO.onIdentityModeChange());
  els.btnSubmitSend.addEventListener("click", () => designIO.send());
  els.btnSubmitCancel.addEventListener("click", () => els.submitDialog.close());

  els.btnCopyPalette.addEventListener("click", copyPalette);
  els.btnDownloadPalette.addEventListener("click", downloadPalette);

  els.btnResetTransform.addEventListener("click", resetSelected);
  els.btnResetAll.addEventListener("click", resetAllTransforms);
  els.btnCopy.addEventListener("click", copyConfig);
  els.btnDownload.addEventListener("click", downloadConfig);
  els.btnImport.addEventListener("click", () => {
    els.importText.value = "";
    els.importDialog.showModal();
    els.importText.focus();
  });
  els.btnImportApply.addEventListener("click", () => {
    els.importDialog.close();
    applyImportedConfig(els.importText.value);
  });
  els.btnImportCancel.addEventListener("click", () => els.importDialog.close());

  els.transformModes.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    els.transformModes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    editor.setMode(btn.dataset.mode);
  });

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", (e) => {
    if (!state.dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

// ---- catalog ----

async function loadCatalog() {
  try {
    const [manifest, palette] = await Promise.all([loadManifest(), loadPalette()]);
    state.manifest = manifest;
    state.palette = palette;
    if (els.aboutVersion && manifest.version) els.aboutVersion.textContent = manifest.version;
    buildPrintUI();
    paletteEditor.render();
    if (manifest.prints.length) {
      await setPrint(manifest.prints[0].id);
      if (isOwner) setDesignMode(true);
    }
  } catch (err) {
    toast("Error loading catalog: " + err.message, true);
  }
}

function buildPrintUI() {
  els.printList.innerHTML = "";
  state.manifest.prints.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "print-card";
    card.dataset.printId = entry.id;
    card.textContent = entry.name;
    card.addEventListener("click", () => {
      if (state.dirty && !confirm("You have unsaved changes. Switch print anyway?")) return;
      setPrint(entry.id);
    });
    els.printList.appendChild(card);
  });
}

function markActivePrint(id) {
  [...els.printList.children].forEach((card) => {
    card.classList.toggle("active", card.dataset.printId === id);
  });
}

// Fetches the print file and its STLs on demand — the manifest alone builds the list.
async function setPrint(idOrPrint) {
  const wanted = typeof idOrPrint === "string" ? idOrPrint : idOrPrint.id;
  if (state.print && state.print.id === wanted && state.records.size) return;

  state.dirty = false;
  state.selectedId = null;
  editor.detach();
  editor.setGroup(null);
  viewer.clearGroup();
  state.records.clear();
  if (state.geometry) state.geometry.dispose();
  state.geometry = new GeometryCache();

  showLoading(true);
  try {
    const print = typeof idOrPrint === "string" ? await loadPrint(wanted) : idOrPrint;
    state.print = print;
    markActivePrint(print.id);
    els.printDesc.textContent = print.description;

    await Promise.all(print.pieces.map((def, i) => loadPiece(print, def, i)));

    pieceList.build(print, state.palette, state.records, state.designOn);
    editor.setGroup(viewer.group);
    viewer.frameView();
    showLoading(false);
    if (state.designOn) editor.select(firstPieceId());
  } catch (err) {
    showLoading(false);
    toast("Error loading print: " + err.message, true);
  }
}

async function loadPiece(print, def, index) {
  if (!def.file) throw new Error("Piece " + def.label + " has no STL file");
  const geometry = await state.geometry.get(def.file, {
    up: print.axes.up,
    centerOrigin: def.centerOrigin,
  });

  const colorId = state.palette.defaultColorOf(def);
  const m = state.palette.toMaterial(colorId);
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(m.color),
    transparent: m.transparent,
    opacity: m.opacity,
    depthWrite: m.depthWrite,
    side: THREE.FrontSide,
    roughness: 0.55,
    metalness: 0.08,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  // Shadow maps have no notion of partial transparency, so a translucent piece
  // casts a solid shadow. We accept that rather than dropping the shadow: in
  // this app shadows mostly fall on neighbouring pieces and read as "this part
  // is here", and a shadowless part looks detached from the assembly.
  // 03-ui-behavior.md#opacity-rendering
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pieceId = def.id;
  mesh.position.set(def.position[0], def.position[1], def.position[2]);
  mesh.rotation.set(def.rotation[0], def.rotation[1], def.rotation[2]);
  mesh.scale.set(def.scale[0], def.scale[1], def.scale[2]);
  viewer.group.add(mesh);

  // Back-face pass. A child of the piece, so it inherits every transform for
  // free, and carries no pieceId so the editor's raycaster ignores it. Drawn
  // before the front faces via renderOrder; only shown while translucent.
  const backMaterial = material.clone();
  backMaterial.side = THREE.BackSide;
  const backMesh = new THREE.Mesh(geometry, backMaterial);
  backMesh.castShadow = false; // the front pass already casts one
  backMesh.receiveShadow = true;
  backMesh.visible = m.twoPass;
  mesh.add(backMesh);

  // Deterministic paint order for the translucent pass.
  //
  // three.js sorts transparent objects by centroid distance, which flips as you
  // orbit nested pieces — and because alpha blending is order-dependent, the
  // whole model visibly snaps to a different apparent opacity at the crossover
  // angle. Ordering by the piece's position in the print file instead keeps the
  // blend identical from every angle. It is an approximation (a piece may
  // composite over one that is physically nearer), but a stable picture beats a
  // correct-then-suddenly-different one. Pieces render back-pass then
  // front-pass, in authored order. 03-ui-behavior.md#opacity-rendering
  backMesh.renderOrder = index * 2;
  mesh.renderOrder = index * 2 + 1;

  state.records.set(def.id, { mesh, backMesh, def, color: colorId });
}

function rebuildPieceList() {
  if (!state.print) return;
  pieceList.build(state.print, state.palette, state.records, state.designOn);
}

// Keep a piece's shown color inside its own offering — removing or restricting
// colors can strand it. Falls back to the first color the piece still offers.
function repairPieceDefault(pieceId) {
  const rec = state.records.get(pieceId);
  if (!rec) return false;
  const offered = state.palette.offeredIds(rec.def);
  if (offered.includes(rec.color)) return false;
  const next = offered[0];
  if (!next) return false;
  rec.color = next;
  rec.def.defaultColor = next;
  applyColor(rec, next);
  return true;
}

// Deleting a color has to unwind every reference to it: the catalog, each
// piece's offered subset, and any piece currently showing it.
function removeColorEverywhere(colorId) {
  const palette = state.palette;
  const i = palette.colors.findIndex((c) => c.id === colorId);
  if (i >= 0) palette.colors.splice(i, 1);
  palette._byId.delete(colorId);

  if (state.print) {
    state.print.pieces.forEach((def) => {
      if (def.palette.length) def.palette = def.palette.filter((c) => c !== colorId);
    });
  }
  let reassigned = 0;
  state.records.forEach((rec, id) => {
    if (repairPieceDefault(id)) reassigned++;
  });

  rebuildPieceList();
  markDirty();
  return { reassigned };
}

function setPieceColor(pieceId, colorId) {
  const rec = state.records.get(pieceId);
  if (!rec || !state.palette.has(colorId)) return false;
  rec.color = colorId;
  // In design mode the choice *is* the piece's default, and exports as such.
  if (state.designOn) rec.def.defaultColor = colorId;
  applyColor(rec, colorId);
  pieceList.syncPiece(pieceId);
  markDirty();
  return true;
}

// Writes a chosen color onto a live material. Switching between opaque and
// translucent changes the shader, so `needsUpdate` matters here.
function applyColor(rec, chosen) {
  const m = state.palette.toMaterial(chosen);
  [rec.mesh.material, rec.backMesh.material].forEach((material) => {
    material.color.set(m.color);
    material.opacity = m.opacity;
    material.depthWrite = m.depthWrite;
    // transparency is compiled into the shader
    if (material.transparent !== m.transparent) {
      material.transparent = m.transparent;
      material.needsUpdate = true;
    }
  });
  rec.backMesh.visible = m.twoPass;
}

// ---- design mode ----

function setDesignMode(on) {
  state.designOn = on;
  els.editorPanel.classList.toggle("hidden", !on);
  editor.setEnabled(on);

  gridVisible = on;
  axesVisible = on;
  viewer.setGridVisible(on);
  viewer.setAxesVisible(on);
  els.btnGrid.classList.toggle("active", on);
  els.btnAxes.classList.toggle("active", on);
  viewer.setDesignNavigation(on);

  if (state.print) pieceList.build(state.print, state.palette, state.records, on);
  if (on) editor.select(state.selectedId || firstPieceId());
  else editor.detach();
  pieceList.updateSelection(state.selectedId);
}

function firstPieceId() {
  const ids = [...state.records.keys()];
  return ids.length ? ids[0] : null;
}

function onSelectPiece(id) {
  state.selectedId = id;
  pieceList.updateSelection(id);
  const rec = state.records.get(id);
  els.selectedName.textContent = rec ? rec.def.label : "";
  buildTransformInputs(id);
}

function onTransformChange(id, t) {
  updateTransformInputs(id, t);
  markDirty();
}

// ---- transform panel ----

const transformVec = (v) => [v.x, v.y, v.z];
const meshTransform = (mesh) => ({
  position: transformVec(mesh.position),
  rotation: transformVec(mesh.rotation),
  scale: transformVec(mesh.scale),
});

function buildTransformInputs(id) {
  els.transformInputs.innerHTML = "";
  const rec = state.records.get(id);
  if (!rec) return;

  const groups = [
    { name: "Position", key: "position", step: 1, decimals: 1, format: (v) => v },
    { name: "Rotation", key: "rotation", step: 1, decimals: 1, format: (v) => THREE.MathUtils.radToDeg(v) },
    { name: "Scale", key: "scale", step: 0.01, decimals: 2, format: (v) => v },
  ];

  groups.forEach((g) => {
    const row = document.createElement("div");
    row.className = "axis-row";
    const label = document.createElement("label");
    label.textContent = g.name;
    row.appendChild(label);

    for (let i = 0; i < 3; i++) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = g.step;
      input.dataset.group = g.key;
      input.dataset.axis = i;
      input.classList.add(["x", "y", "z"][i]);
      input.value = g.format(meshTransform(rec.mesh)[g.key][i]).toFixed(g.decimals);
      input.addEventListener("input", () => {
        const t = meshTransform(rec.mesh);
        const raw = parseFloat(input.value);
        const val = isNaN(raw) ? 0 : raw;
        t[g.key][input.dataset.axis] = g.key === "rotation" ? THREE.MathUtils.degToRad(val) : val;
        editor.applyTransform(id, t);
      });
      row.appendChild(input);
    }
    els.transformInputs.appendChild(row);
  });

  updateTransformInputs(id, meshTransform(rec.mesh));
}

function updateTransformInputs(id, t) {
  if (!t) return;
  els.transformInputs.querySelectorAll("input").forEach((input) => {
    if (document.activeElement === input) return;
    const raw = t[input.dataset.group][input.dataset.axis];
    const val = input.dataset.group === "rotation" ? THREE.MathUtils.radToDeg(raw) : raw;
    input.value = (Math.round(val * 100) / 100).toString();
  });
}

function resetSelected() {
  if (!state.selectedId) return;
  const rec = state.records.get(state.selectedId);
  if (!rec) return;
  editor.applyTransform(state.selectedId, {
    position: rec.def.position,
    rotation: rec.def.rotation,
    scale: rec.def.scale,
  });
  updateTransformInputs(state.selectedId, meshTransform(rec.mesh));
}

function resetAllTransforms() {
  state.print.pieces.forEach((def) => {
    editor.applyTransform(def.id, { position: def.position, rotation: def.rotation, scale: def.scale });
  });
  if (state.selectedId) {
    const rec = state.records.get(state.selectedId);
    if (rec) updateTransformInputs(state.selectedId, meshTransform(rec.mesh));
  }
  viewer.frameView();
}

// ---- print config export / import (owner) ----

function palettePayload() {
  const palette = state.palette;
  return JSON.stringify(
    {
      version: palette.version,
      colors: palette.colors.map((c) => ({
        id: c.id,
        name: c.name,
        hex: c.hex,
        opacity: c.opacity,
      })),
    },
    null,
    2
  );
}

function copyPalette() {
  const json = palettePayload();
  const done = () => toast("palette.json copied to clipboard");
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).then(done).catch(() => fallbackCopy(json, done));
  } else {
    fallbackCopy(json, done);
  }
}

function downloadPalette() {
  const blob = new Blob([palettePayload()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "palette.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("Downloaded palette.json");
}

function exportJson() {
  return JSON.stringify(buildExportObject(state.print, state.records), null, 2);
}

function copyConfig() {
  const json = exportJson();
  const done = () => {
    state.dirty = false;
    toast("Config copied to clipboard");
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json).then(done).catch(() => fallbackCopy(json, done));
  } else {
    fallbackCopy(json, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    done();
  } catch {
    toast("Could not copy — use Download JSON", true);
  }
  document.body.removeChild(ta);
}

function downloadConfig() {
  const blob = new Blob([exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "prints/" + state.print.id + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  state.dirty = false;
  toast("Downloaded " + a.download);
}

function applyImportedConfig(text) {
  let parsed;
  try {
    parsed = normalizePrint(JSON.parse(text));
  } catch (err) {
    toast("Invalid JSON: " + err.message, true);
    return;
  }
  if (!parsed.pieces.length) {
    toast("Config has no pieces", true);
    return;
  }
  if (!state.print || parsed.id !== state.print.id) {
    setPrint(parsed);
    return;
  }

  parsed.pieces.forEach((p) => {
    const rec = state.records.get(p.id);
    if (!rec) return;
    rec.mesh.position.set(p.position[0], p.position[1], p.position[2]);
    rec.mesh.rotation.set(p.rotation[0], p.rotation[1], p.rotation[2]);
    rec.mesh.scale.set(p.scale[0], p.scale[1], p.scale[2]);
    const colorId = state.palette.has(p.defaultColor) ? p.defaultColor : rec.color;
    rec.color = colorId;
    applyColor(rec, colorId);
  });

  pieceList.syncActive();
  if (state.selectedId) {
    const rec = state.records.get(state.selectedId);
    if (rec) updateTransformInputs(state.selectedId, meshTransform(rec.mesh));
  }
  viewer.frameView();
  state.dirty = false;
  toast("Imported transforms and colors");
}

// ---- keyboard ----

function onKeyDown(e) {
  if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
  if (e.key === "f" || e.key === "F") viewer.frameView();
  if (!state.designOn) return;

  const modeMap = { g: "translate", G: "translate", r: "rotate", R: "rotate", s: "scale", S: "scale" };
  if (modeMap[e.key]) {
    e.preventDefault();
    const mode = modeMap[e.key];
    els.transformModes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
    editor.setMode(mode);
  }
  if (e.key === "Escape") {
    editor.detach();
    state.selectedId = null;
    pieceList.updateSelection(null);
  }
}

init();
