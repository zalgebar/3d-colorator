import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { normalizeConfig, buildExportObject } from "./config.js";
import { DesignEditor } from "./editor.js";
import {
  hasExtension,
  getRecipient,
  resolveIdentity,
  sendDesign,
  buildDesignPayload,
  savedNsec,
  saveNsec,
  npubOf,
} from "./nostr.js";

const NT = window.NostrTools;
const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<path class="lens" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
  "</svg>";

const isOwner = new URLSearchParams(window.location.search).has("design");

const state = {
  configs: [],
  current: null,
  group: null,
  records: new Map(),
  selectedId: null,
  designOn: false,
};

const els = {
  enclosureList: document.getElementById("enclosure-list"),
  enclosureDesc: document.getElementById("enclosure-desc"),
  pieceList: document.getElementById("piece-list"),
  designPanel: document.getElementById("editor-panel"),
  selectedName: document.getElementById("selected-name"),
  transformModes: document.getElementById("transform-modes"),
  transformInputs: document.getElementById("transform-inputs"),
  btnResetTransform: document.getElementById("btn-reset-transform"),
  btnResetAll: document.getElementById("btn-reset-all"),
  btnFrame: document.getElementById("btn-frame"),
  btnOrigin: document.getElementById("btn-origin"),
  btnAxes: document.getElementById("btn-axes"),
  btnGrid: document.getElementById("btn-grid"),
  btnScreenshot: document.getElementById("btn-screenshot"),
  btnCopy: document.getElementById("btn-copy"),
  btnDownload: document.getElementById("btn-download"),
  btnImport: document.getElementById("btn-import"),
  btnDownloadDesign: document.getElementById("btn-download-design"),
  btnImportDesign: document.getElementById("btn-import-design"),
  btnSubmit: document.getElementById("btn-submit"),
  importDialog: document.getElementById("import-dialog"),
  importText: document.getElementById("import-text"),
  btnImportApply: document.getElementById("btn-import-apply"),
  btnImportCancel: document.getElementById("btn-import-cancel"),
  designImportDialog: document.getElementById("design-import-dialog"),
  designFile: document.getElementById("design-file"),
  designImportText: document.getElementById("design-import-text"),
  btnDesignImportApply: document.getElementById("btn-design-import-apply"),
  btnDesignImportCancel: document.getElementById("btn-design-import-cancel"),
  submitDialog: document.getElementById("submit-dialog"),
  orderId: document.getElementById("order-id"),
  identityMode: document.getElementById("identity-mode"),
  identityExtension: document.getElementById("identity-extension"),
  extensionPubkey: document.getElementById("extension-pubkey"),
  identityNsec: document.getElementById("identity-nsec"),
  nsecInput: document.getElementById("nsec-input"),
  nsecRemember: document.getElementById("nsec-remember"),
  identityOnetime: document.getElementById("identity-onetime"),
  onetimePubkey: document.getElementById("onetime-pubkey"),
  submitPreview: document.getElementById("submit-preview"),
  submitStatus: document.getElementById("submit-status"),
  btnSubmitSend: document.getElementById("btn-submit-send"),
  btnSubmitCancel: document.getElementById("btn-submit-cancel"),
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
  viewport: document.getElementById("viewport"),
};

let renderer, scene, camera, controls, dirLight, editor, loader, grid, axes;
let toastTimer = null;
let onetimeSk = null;
let gridVisible = isOwner;
let axesVisible = isOwner;
let dirty = false;

function markDirty() {
  dirty = true;
}

function init() {
  renderer = new THREE.WebGLRenderer({ canvas: els.viewport, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
  camera.position.set(120, 90, -160);

  controls = new OrbitControls(camera, els.viewport);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a4050, 0.55);
  scene.add(hemi);

  dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(2048, 2048);
  dirLight.shadow.bias = -0.0004;
  scene.add(dirLight);
  scene.add(dirLight.target);

  const fill = new THREE.DirectionalLight(0x7d9bff, 0.5);
  fill.position.set(-120, 60, -140);
  scene.add(fill);

  grid = new THREE.GridHelper(240, 24, 0x39414d, 0x232932);
  grid.position.y = -0.01;
  scene.add(grid);
  grid.visible = gridVisible;
  els.btnGrid.classList.toggle("active", gridVisible);

  axes = new THREE.AxesHelper(30);
  scene.add(axes);
  axes.visible = axesVisible;
  els.btnAxes.classList.toggle("active", axesVisible);

  state.group = new THREE.Group();
  scene.add(state.group);

  loader = new STLLoader();

  editor = new DesignEditor({
    scene,
    camera,
    dom: els.viewport,
    controls,
    onSelect: (id) => onSelectPiece(id),
    onTransform: (id, t) => onTransformChange(id, t),
  });

  const ro = new ResizeObserver(onResize);
  ro.observe(els.viewport.parentElement);
  onResize();

  wireUI();
  applyOwnerGating(isOwner);
  loadCatalog();
  animate();
}

function applyOwnerGating(owner) {
  document.querySelectorAll("[data-owner-only]").forEach((el) => el.classList.toggle("hidden", !owner));
  document.querySelectorAll("[data-public-only]").forEach((el) => el.classList.toggle("hidden", owner));
}

function wireUI() {
  els.btnFrame.addEventListener("click", frameView);
  els.btnOrigin.addEventListener("click", centerOnOrigin);
  els.btnAxes.addEventListener("click", toggleAxes);
  els.btnGrid.addEventListener("click", toggleGrid);
  els.btnScreenshot.addEventListener("click", screenshot);
  els.btnDownloadDesign.addEventListener("click", downloadDesign);
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
    applyImportedDesign(text);
  });
  els.btnDesignImportApply.addEventListener("click", () => {
    els.designImportDialog.close();
    applyImportedDesign(els.designImportText.value);
  });
  els.btnDesignImportCancel.addEventListener("click", () => els.designImportDialog.close());
  els.btnSubmit.addEventListener("click", openSubmitDialog);
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
    applyImported(els.importText.value);
  });
  els.btnImportCancel.addEventListener("click", () => els.importDialog.close());

  els.transformModes.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    els.transformModes.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    editor.setMode(btn.dataset.mode);
  });

  els.orderId.addEventListener("input", updateSubmitPreview);
  els.identityMode.addEventListener("change", onIdentityModeChange);
  els.btnSubmitSend.addEventListener("click", onSubmitSend);
  els.btnSubmitCancel.addEventListener("click", () => els.submitDialog.close());

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("beforeunload", (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = "";
  });
}

function onResize() {
  const wrap = els.viewport.parentElement;
  const w = wrap.clientWidth;
  const h = wrap.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

async function loadCatalog() {
  try {
    const res = await fetch("enclosures/manifest.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load enclosures/manifest.json (" + res.status + ")");
    const manifest = await res.json();
    const ids = Array.isArray(manifest.enclosures) ? manifest.enclosures : [];
    const configs = [];
    for (const id of ids) {
      const r = await fetch("enclosures/" + encodeURIComponent(id) + ".json", { cache: "no-cache" });
      if (!r.ok) throw new Error("Could not load enclosure " + id);
      configs.push(normalizeConfig(await r.json()));
    }
    state.configs = configs;
    buildEnclosureUI();
    if (configs.length) {
      await setEnclosure(configs[0]);
      if (isOwner) setDesignMode(true);
    }
  } catch (err) {
    toast("Error loading enclosures: " + err.message, true);
  }
}

function buildEnclosureUI() {
  els.enclosureList.innerHTML = "";
  state.configs.forEach((cfg) => {
    const card = document.createElement("div");
    card.className = "enclosure-card";
    card.textContent = cfg.name;
    card.addEventListener("click", () => {
      if (dirty && !confirm("You have unsaved changes. Switch enclosure anyway?")) return;
      setEnclosure(cfg);
    });
    els.enclosureList.appendChild(card);
  });
}

function markActiveEnclosure(id) {
  [...els.enclosureList.children].forEach((card, i) => {
    card.classList.toggle("active", state.configs[i].id === id);
  });
}

async function setEnclosure(config) {
  if (state.current && state.current.id === config.id && state.group.children.length > 0) return;
  dirty = false;
  state.current = config;
  state.selectedId = null;
  editor.detach();
  editor.setGroup(null);
  clearGroup();
  state.records.clear();
  markActiveEnclosure(config.id);
  els.enclosureDesc.textContent = config.description;
  buildPieceUI(config);
  showLoading(true);
  try {
    await Promise.all(config.pieces.map((def) => loadPiece(config, def)));
    editor.setGroup(state.group);
    frameView();
    showLoading(false);
    if (state.designOn) editor.select(firstPieceId());
  } catch (err) {
    showLoading(false);
    toast("Error loading STL: " + err.message, true);
  }
}

function clearGroup() {
  while (state.group.children.length) {
    const child = state.group.children[0];
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
    state.group.remove(child);
  }
}

async function loadPiece(config, def) {
  if (!def.file) throw new Error("Piece " + def.label + " has no STL file");
  const geometry = await loader.loadAsync(def.file);
  if (config.axes && config.axes.up === "z") geometry.rotateX(-Math.PI / 2);
  geometry.computeVertexNormals();
  if (def.centerOrigin !== false) geometry.center();
  geometry.computeBoundingBox();

  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.defaultColor),
    roughness: 0.55,
    metalness: 0.08,
    flatShading: true,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.pieceId = def.id;
  applyTransform(mesh, def);
  state.group.add(mesh);

  const record = { mesh, def, color: def.defaultColor };
  state.records.set(def.id, record);
  updateSwatchActive(def.id);
}

function applyTransform(mesh, t) {
  mesh.position.set(t.position[0], t.position[1], t.position[2]);
  mesh.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  mesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
}

function buildPieceUI(config) {
  els.pieceList.innerHTML = "";
  config.pieces.forEach((def) => {
    const row = document.createElement("div");
    row.className = "piece-row";
    row.dataset.pieceId = def.id;

    const top = document.createElement("div");
    top.className = "piece-row-top";

    const label = document.createElement("div");
    label.className = "piece-label";
    label.textContent = def.label;

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "piece-eye";
    eye.title = "Show / hide this piece";
    eye.innerHTML = EYE_SVG;
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePieceVisible(def.id);
    });

    top.appendChild(label);
    top.appendChild(eye);
    row.appendChild(top);

    let customColor = null;
    if (state.designOn) {
      const tools = document.createElement("div");
      tools.className = "piece-tools";

      customColor = document.createElement("input");
      customColor.type = "color";
      customColor.className = "piece-custom-color";
      customColor.value = def.defaultColor;
      customColor.title = "Free color picker";
      customColor.addEventListener("input", (e) => {
        const rec = state.records.get(def.id);
        if (!rec) return;
        rec.color = e.target.value;
        rec.mesh.material.color.set(e.target.value);
        updateSwatchActive(def.id);
        markDirty();
      });
      customColor.addEventListener("click", (e) => e.stopPropagation());

      const add = document.createElement("button");
      add.type = "button";
      add.className = "btn-add-swatch";
      add.textContent = "+";
      add.title = "Add this color to the swatch options";
      add.addEventListener("click", (e) => {
        e.stopPropagation();
        const color = customColor.value;
        if (!color || def.colors.includes(color)) {
          toast("Color already in palette", true);
          return;
        }
        def.colors.push(color);
        addSwatchButton(def.id, color);
        toast("Added " + color + " to palette (saved in JSON export)");
      });

      tools.appendChild(customColor);
      tools.appendChild(add);
      row.appendChild(tools);
    }

    const swatches = document.createElement("div");
    swatches.className = "color-swatches";

    def.colors.forEach((c) => {
      swatches.appendChild(makeSwatch(def.id, c));
    });
    if (!def.colors.length && !state.designOn) {
      const fallback = document.createElement("input");
      fallback.type = "color";
      fallback.className = "piece-custom-color";
      fallback.value = def.defaultColor;
      fallback.title = "Pick a color";
      fallback.addEventListener("input", (e) => {
        const rec = state.records.get(def.id);
        if (!rec) return;
        rec.color = e.target.value;
        rec.mesh.material.color.set(e.target.value);
        markDirty();
      });
      fallback.addEventListener("click", (e) => e.stopPropagation());
      swatches.appendChild(fallback);
    }
    row.appendChild(swatches);

    row.addEventListener("click", (e) => {
      if (e.target === customColor) return;
      const rec = state.records.get(def.id);
      if (!rec || !rec.mesh.visible) return;
      if (state.designOn) {
        editor.select(def.id);
      }
    });

    els.pieceList.appendChild(row);
  });
}

function makeSwatch(pieceId, color) {
  const sw = document.createElement("button");
  sw.type = "button";
  sw.className = "color-swatch";
  sw.style.background = color;
  sw.dataset.color = color;
  sw.title = color;
  sw.addEventListener("click", (e) => {
    e.stopPropagation();
    const rec = state.records.get(pieceId);
    if (!rec) return;
    rec.color = color;
    rec.mesh.material.color.set(color);
    updateSwatchActive(pieceId);
    markDirty();
  });
  return sw;
}

function addSwatchButton(pieceId, color) {
  const row = els.pieceList.querySelector('.piece-row[data-piece-id="' + pieceId + '"]');
  if (!row) return;
  const swatches = row.querySelector(".color-swatches");
  swatches.appendChild(makeSwatch(pieceId, color));
  updateSwatchActive(pieceId);
}

function setDesignMode(on) {
  state.designOn = on;
  els.designPanel.classList.toggle("hidden", !on);
  editor.setEnabled(on);
  if (state.current) {
    buildPieceUI(state.current);
    syncColorInputs();
    [...state.records.keys()].forEach(updateEyeState);
    updatePieceRowSelection();
  }
  gridVisible = on;
  grid.visible = on;
  els.btnGrid.classList.toggle("active", on);
  axesVisible = on;
  axes.visible = on;
  els.btnAxes.classList.toggle("active", on);
  if (on) {
    controls.mouseButtons = {
      LEFT: -1,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    editor.select(state.selectedId || firstPieceId());
  } else {
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN,
    };
    editor.detach();
  }
  updatePieceRowSelection();
}

function firstPieceId() {
  const ids = [...state.records.keys()];
  return ids.length ? ids[0] : null;
}

function onSelectPiece(id) {
  state.selectedId = id;
  updatePieceRowSelection();
  els.selectedName.textContent = pieceLabel(id);
  buildTransformInputs(id);
}

function pieceLabel(id) {
  const rec = state.records.get(id);
  return rec ? rec.def.label : "";
}

function onTransformChange(id, t) {
  updateTransformInputs(id, t);
  markDirty();
}

function buildTransformInputs(id) {
  els.transformInputs.innerHTML = "";
  const def = state.records.get(id).def;
  const groups = [
    { name: "Position", key: "position", fromMesh: () => transformVec(state.records.get(id).mesh.position), step: 1, decimals: 1, format: (v) => v },
    { name: "Rotation", key: "rotation", fromMesh: () => transformVec(state.records.get(id).mesh.rotation), step: 1, decimals: 1, format: (v) => THREE.MathUtils.radToDeg(v) },
    { name: "Scale", key: "scale", fromMesh: () => transformVec(state.records.get(id).mesh.scale), step: 0.01, decimals: 2, format: (v) => v },
  ];

  groups.forEach((g) => {
    const row = document.createElement("div");
    row.className = "axis-row";
    const label = document.createElement("label");
    label.textContent = g.name;
    row.appendChild(label);

    const inputs = [];
    for (let i = 0; i < 3; i++) {
      const input = document.createElement("input");
      input.type = "number";
      input.step = g.step;
      input.dataset.group = g.key;
      input.dataset.axis = i;
      input.classList.add(["x", "y", "z"][i]);
      input.value = g.format(g.fromMesh()[i]).toFixed(g.decimals);
      input.addEventListener("input", () => {
        const t = {
          position: transformVec(state.records.get(id).mesh.position),
          rotation: transformVec(state.records.get(id).mesh.rotation),
          scale: transformVec(state.records.get(id).mesh.scale),
        };
        const raw = parseFloat(input.value);
        const val = isNaN(raw) ? 0 : raw;
        t[g.key][input.dataset.axis] = g.key === "rotation" ? THREE.MathUtils.degToRad(val) : val;
        editor.applyTransform(id, t);
      });
      inputs.push(input);
      row.appendChild(input);
    }
    els.transformInputs.appendChild(row);
  });
  updateTransformInputs(id, gTransform(state.records.get(id).mesh));
}

function gTransform(mesh) {
  return {
    position: transformVec(mesh.position),
    rotation: transformVec(mesh.rotation),
    scale: transformVec(mesh.scale),
  };
}

function transformVec(v) {
  return [v.x, v.y, v.z];
}

function updateTransformInputs(id, t) {
  if (!t) return;
  const inputs = els.transformInputs.querySelectorAll("input");
  inputs.forEach((input) => {
    if (document.activeElement === input) return;
    const key = input.dataset.group;
    const axis = input.dataset.axis;
    const raw = t[key][axis];
    const val = key === "rotation" ? THREE.MathUtils.radToDeg(raw) : raw;
    input.value = (Math.round(val * 100) / 100).toString();
  });
}

function updatePieceRowSelection() {
  [...els.pieceList.children].forEach((row) => {
    row.classList.toggle("selected", row.dataset.pieceId === state.selectedId);
  });
}

function updateSwatchActive(id) {
  const rec = state.records.get(id);
  const row = els.pieceList.querySelector('.piece-row[data-piece-id="' + id + '"]');
  if (!row || !rec) return;
  row.querySelectorAll(".color-swatch").forEach((sw) => {
    sw.classList.toggle("active", sw.dataset.color === rec.color);
  });
}

function togglePieceVisible(id) {
  const rec = state.records.get(id);
  if (!rec) return;
  rec.mesh.visible = !rec.mesh.visible;
  if (!rec.mesh.visible && state.selectedId === id) {
    editor.detach();
    state.selectedId = null;
    updatePieceRowSelection();
  }
  updateEyeState(id);
  if (!rec.mesh.visible) frameView();
}

function updateEyeState(id) {
  const rec = state.records.get(id);
  const row = els.pieceList.querySelector('.piece-row[data-piece-id="' + id + '"]');
  if (!row || !rec) return;
  row.querySelector(".piece-eye").classList.toggle("off", !rec.mesh.visible);
  row.querySelectorAll("input[type=color], .color-swatch, .btn-add-swatch").forEach((el) => (el.disabled = !rec.mesh.visible));
  row.classList.toggle("dimmed", !rec.mesh.visible);
}

function resetSelected() {
  if (!state.selectedId) return;
  const def = state.records.get(state.selectedId).def;
  editor.applyTransform(state.selectedId, { position: def.position, rotation: def.rotation, scale: def.scale });
  updateTransformInputs(state.selectedId, gTransform(state.records.get(state.selectedId).mesh));
}

function resetAllTransforms() {
  state.current.pieces.forEach((def) => {
    editor.applyTransform(def.id, { position: def.position, rotation: def.rotation, scale: def.scale });
  });
  if (state.selectedId) {
    updateTransformInputs(state.selectedId, gTransform(state.records.get(state.selectedId).mesh));
  }
  frameView();
}

function frameView() {
  const box = new THREE.Box3();
  state.group.children.forEach((child) => {
    if (child.visible && child.geometry) box.expandByObject(child);
  });
  if (box.isEmpty()) {
    box.setFromObject(state.group);
  }
  if (box.isEmpty()) return;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const center = sphere.center;
  const radius = Math.max(sphere.radius, 15);

  controls.target.copy(center);

  const dist = radius / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 1.5;
  const dir = new THREE.Vector3(0.65, 0.5, -1).normalize();
  camera.position.copy(center).add(dir.multiplyScalar(dist));

  dirLight.position.copy(center).add(new THREE.Vector3(radius * 1.2, radius * 2, radius * 1.2));
  dirLight.target.position.copy(center);
  const s = radius * 1.6;
  dirLight.shadow.camera.left = -s;
  dirLight.shadow.camera.right = s;
  dirLight.shadow.camera.top = s;
  dirLight.shadow.camera.bottom = -s;
  dirLight.shadow.camera.near = 0.1;
  dirLight.shadow.camera.far = radius * 6;
  dirLight.shadow.camera.updateProjectionMatrix();

  controls.update();
}

function centerOnOrigin() {
  const offset = camera.position.clone().sub(controls.target);
  controls.target.set(0, 0, 0);
  camera.position.copy(controls.target).add(offset);
  controls.update();
  toast("Centered on origin");
}

function toggleAxes() {
  axesVisible = !axesVisible;
  axes.visible = axesVisible;
  els.btnAxes.classList.toggle("active", axesVisible);
  toast(axesVisible ? "Axis marker on" : "Axis marker off");
}

function toggleGrid() {
  gridVisible = !gridVisible;
  grid.visible = gridVisible;
  els.btnGrid.classList.toggle("active", gridVisible);
  toast(gridVisible ? "Grid on" : "Grid off");
}

function screenshot() {
  renderer.render(scene, camera);
  const canvas = renderer.domElement;
  canvas.toBlob((blob) => {
    if (!blob) {
      toast("Could not capture image", true);
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const name = "design-" + state.current.id + "-" + stamp + ".png";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Saved " + name);
  }, "image/png");
}

function copyConfig() {
  const json = JSON.stringify(buildExportObject(state.current, state.records), null, 2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json)
      .then(() => {
        dirty = false;
        toast("Config copied to clipboard");
      })
      .catch(() => fallbackCopy(json));
  } else {
    fallbackCopy(json);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    dirty = false;
    toast("Config copied to clipboard");
  } catch {
    toast("Could not copy — use Download JSON", true);
  }
  document.body.removeChild(ta);
}

function downloadConfig() {
  const json = JSON.stringify(buildExportObject(state.current, state.records), null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "enclosures/" + state.current.id + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  dirty = false;
  toast("Downloaded " + a.download);
}

function currentColors() {
  const colors = {};
  [...state.records.entries()].forEach(([id, rec]) => {
    colors[id] = rec.color;
  });
  return colors;
}

function designPayload(orderId, author) {
  return buildDesignPayload({
    orderId: orderId || "",
    enclosure: state.current.id,
    enclosureName: state.current.name,
    author: author || "",
    colors: currentColors(),
  });
}

function downloadDesign() {
  if (!state.current) return;
  const name = state.current.id + "-design.json";
  const blob = new Blob([designPayload("", "")], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  dirty = false;
  toast("Saved " + name);
}

function applyImportedDesign(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    toast("Invalid JSON: " + err.message, true);
    return;
  }
  if (!parsed || parsed.type !== "enclosure-design" || !parsed.colors) {
    toast("Not a design file (missing type/colors)", true);
    return;
  }
  if (parsed.enclosure && state.current && parsed.enclosure !== state.current.id) {
    toast("This design is for '" + (parsed.enclosureName || parsed.enclosure) + "' — switch enclosure first.", true);
    return;
  }
  let applied = 0;
  Object.entries(parsed.colors).forEach(([id, color]) => {
    if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) return;
    const rec = state.records.get(id);
    if (!rec) return;
    rec.color = color.toLowerCase();
    rec.mesh.material.color.set(rec.color);
    applied++;
  });
  syncColorInputs();
  if (applied) {
    dirty = false;
    toast("Imported " + applied + " color" + (applied === 1 ? "" : "s"));
  } else {
    toast("No matching pieces found", true);
  }
}

function openSubmitDialog() {
  if (!state.current) return;
  onetimeSk = null;
  els.submitStatus.classList.add("hidden");
  els.submitStatus.textContent = "";
  const extOption = els.identityMode.querySelector('option[value="extension"]');
  if (extOption) extOption.disabled = !hasExtension();
  const defaultMode = hasExtension() ? "extension" : "nsec";
  els.identityMode.value = defaultMode;
  els.orderId.value = "";
  els.nsecInput.value = savedNsec();
  els.nsecRemember.checked = !!savedNsec();
  els.btnSubmitSend.disabled = false;
  onIdentityModeChange();
  els.submitDialog.showModal();
  els.orderId.focus();
}

async function onIdentityModeChange() {
  const mode = els.identityMode.value;
  els.identityExtension.classList.toggle("hidden", mode !== "extension");
  els.identityNsec.classList.toggle("hidden", mode !== "nsec");
  els.identityOnetime.classList.toggle("hidden", mode !== "onetime");
  if (mode === "extension") {
    els.extensionPubkey.textContent = "Reading extension…";
    try {
      const pk = await window.nostr.getPublicKey();
      els.extensionPubkey.textContent = "Connected: " + npubOf(pk);
    } catch (err) {
      els.extensionPubkey.textContent = "Could not read extension: " + err.message;
    }
  }
  if (mode === "onetime") {
    if (!onetimeSk) onetimeSk = NT.generateSecretKey();
    els.onetimePubkey.textContent = "Your npub: " + npubOf(NT.getPublicKey(onetimeSk));
  }
  updateSubmitPreview();
}

function updateSubmitPreview() {
  els.submitPreview.value = designPayload(els.orderId.value.trim(), "");
}

function submitStatus(msg, isError) {
  els.submitStatus.textContent = msg;
  els.submitStatus.classList.toggle("error", !!isError);
  els.submitStatus.classList.toggle("ok", !isError);
  els.submitStatus.classList.remove("hidden");
}

async function onSubmitSend() {
  const orderId = els.orderId.value.trim();
  if (!orderId) {
    submitStatus("Enter a TakeMySats Order ID first.", true);
    els.orderId.focus();
    return;
  }
  const mode = els.identityMode.value;
  const nsec = els.nsecInput.value.trim();
  let identity;
  try {
    identity = await resolveIdentity(mode, onetimeSk, nsec);
  } catch (err) {
    submitStatus(err.message, true);
    return;
  }

  if (mode === "nsec") {
    if (els.nsecRemember.checked && nsec) saveNsec(nsec);
    els.nsecInput.value = "";
  }

  els.btnSubmitSend.disabled = true;
  submitStatus("Sending…");

  const content = designPayload(orderId, identity.pubkey);
  const recipient = await getRecipient();

  try {
    const res = await sendDesign({
      recipient,
      identity,
      content,
      subject: "SeedSigner enclosure design - order " + orderId,
      onStatus: (m) => submitStatus(m),
    });
    if (res.ok > 0) {
      submitStatus("Sent to " + res.ok + "/" + res.relays + " relays.\nEvent: " + res.wrapId);
    } else {
      submitStatus("Could not publish to any of " + res.relays + " relays.\nEvent: " + res.wrapId, true);
    }
  } catch (err) {
    submitStatus("Failed to send: " + err.message, true);
  } finally {
    els.btnSubmitSend.disabled = false;
  }
}

function applyImported(text) {
  let parsed;
  try {
    parsed = normalizeConfig(JSON.parse(text));
  } catch (err) {
    toast("Invalid JSON: " + err.message, true);
    return;
  }
  if (!parsed.pieces.length) {
    toast("Config has no pieces", true);
    return;
  }

  if (!state.current || parsed.id !== state.current.id) {
    setEnclosure(parsed);
    return;
  }

  parsed.pieces.forEach((p) => {
    const rec = state.records.get(p.id);
    if (!rec) return;
    applyTransform(rec.mesh, p);
    rec.color = p.defaultColor;
    rec.mesh.material.color.set(p.defaultColor);
  });

  syncColorInputs();
  if (state.selectedId) {
    updateTransformInputs(state.selectedId, gTransform(state.records.get(state.selectedId).mesh));
  }
  frameView();
  dirty = false;
  toast("Imported transforms and colors");
}

function syncColorInputs() {
  [...els.pieceList.children].forEach((row) => {
    const rec = state.records.get(row.dataset.pieceId);
    if (!rec) return;
    const colorInput = row.querySelector("input[type=color]");
    if (colorInput) colorInput.value = rec.color;
    updateSwatchActive(row.dataset.pieceId);
  });
}

function onKeyDown(e) {
  const typing = e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA");
  if (typing) return;
  if (e.key === "f" || e.key === "F") frameView();
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
    updatePieceRowSelection();
  }
}

function showLoading(on) {
  els.loading.classList.toggle("hidden", !on);
}

function toast(msg, isError) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("error", !!isError);
  els.toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add("hidden"), 3000);
}

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}

init();
