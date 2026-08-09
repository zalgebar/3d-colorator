import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STLLoader } from "three/addons/loaders/STLLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { normalizeConfig, buildExportObject } from "./config.js";
import { DesignEditor } from "./editor.js";

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
  designToggle: document.getElementById("design-toggle"),
  designPanel: document.getElementById("editor-panel"),
  selectedName: document.getElementById("selected-name"),
  transformModes: document.getElementById("transform-modes"),
  transformInputs: document.getElementById("transform-inputs"),
  btnResetTransform: document.getElementById("btn-reset-transform"),
  btnResetAll: document.getElementById("btn-reset-all"),
  btnFrame: document.getElementById("btn-frame"),
  btnCopy: document.getElementById("btn-copy"),
  btnDownload: document.getElementById("btn-download"),
  btnImport: document.getElementById("btn-import"),
  importDialog: document.getElementById("import-dialog"),
  importText: document.getElementById("import-text"),
  btnImportApply: document.getElementById("btn-import-apply"),
  btnImportCancel: document.getElementById("btn-import-cancel"),
  loading: document.getElementById("loading"),
  toast: document.getElementById("toast"),
  viewport: document.getElementById("viewport"),
};

let renderer, scene, camera, controls, dirLight, editor, loader;
let toastTimer = null;

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

  const grid = new THREE.GridHelper(240, 24, 0x39414d, 0x232932);
  grid.position.y = -0.01;
  scene.add(grid);

  const axes = new THREE.AxesHelper(30);
  scene.add(axes);

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
  els.designToggle.addEventListener("change", (e) => setDesignMode(e.target.checked));
  els.btnFrame.addEventListener("click", frameView);
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

  window.addEventListener("keydown", onKeyDown);
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
    const res = await fetch("enclosures/manifest.json");
    if (!res.ok) throw new Error("Could not load enclosures/manifest.json (" + res.status + ")");
    const manifest = await res.json();
    const ids = Array.isArray(manifest.enclosures) ? manifest.enclosures : [];
    const configs = [];
    for (const id of ids) {
      const r = await fetch("enclosures/" + encodeURIComponent(id) + ".json");
      if (!r.ok) throw new Error("Could not load enclosure " + id);
      configs.push(normalizeConfig(await r.json()));
    }
    state.configs = configs;
    buildEnclosureUI();
    if (configs.length) await setEnclosure(configs[0]);
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
    card.addEventListener("click", () => setEnclosure(cfg));
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

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = def.defaultColor;
    colorInput.addEventListener("input", (e) => {
      const rec = state.records.get(def.id);
      if (!rec) return;
      rec.color = e.target.value;
      rec.mesh.material.color.set(e.target.value);
    });

    const label = document.createElement("div");
    label.className = "piece-label";
    label.textContent = def.label;

    row.appendChild(colorInput);
    row.appendChild(label);

    row.addEventListener("click", (e) => {
      if (e.target === colorInput) return;
      if (state.designOn) {
        editor.select(def.id);
      }
    });

    els.pieceList.appendChild(row);
  });
}

function setDesignMode(on) {
  state.designOn = on;
  els.designPanel.classList.toggle("hidden", !on);
  editor.setEnabled(on);
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
  const box = new THREE.Box3().setFromObject(state.group);
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

function copyConfig() {
  const json = JSON.stringify(buildExportObject(state.current, state.records), null, 2);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(json)
      .then(() => toast("Config copied to clipboard"))
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
  toast("Downloaded " + a.download);
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
  toast("Imported transforms and colors");
}

function syncColorInputs() {
  [...els.pieceList.children].forEach((row) => {
    const rec = state.records.get(row.dataset.pieceId);
    if (rec) {
      row.querySelector("input[type=color]").value = rec.color;
    }
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
