import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { transformToArray } from "./data/prints.js";

export class DesignEditor {
  constructor({ scene, camera, dom, controls, onSelect, onTransform }) {
    this.scene = scene;
    this.camera = camera;
    this.dom = dom;
    this.orbit = controls;
    this.onSelect = onSelect;
    this.onTransform = onTransform;

    this.group = null;
    this.meshes = new Map();
    this.selectedId = null;
    this.enabled = false;

    this.tc = new TransformControls(camera, dom);
    this.tc.setMode("translate");
    this.tc.setSize(0.9);
    scene.add(this.tc.getHelper());

    this.tc.addEventListener("dragging-changed", (e) => {
      if (this.enabled) this.orbit.enabled = !e.value;
    });

    this.tc.addEventListener("objectChange", () => {
      if (this.selectedId && this.onTransform) {
        this.onTransform(this.selectedId, this.transformOf(this.selectedId));
      }
    });

    this.dom.addEventListener("pointerdown", (e) => this.handlePointerDown(e));
  }

  setGroup(group) {
    this.group = group;
    this.rebuild();
  }

  rebuild() {
    this.meshes.clear();
    if (!this.group) return;
    this.group.traverse((o) => {
      if (o.isMesh && o.userData.pieceId) this.meshes.set(o.userData.pieceId, o);
    });
  }

  setEnabled(on) {
    this.enabled = on;
    this.tc.enabled = on;
    if (!on) this.detach();
  }

  select(id) {
    if (!this.enabled) return;
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    if (this.selectedId === id || this.tc.dragging) return;
    this.selectedId = id;
    this.tc.attach(mesh);
    // Selecting is not editing: onSelect populates the transform panel from the
    // mesh, so firing onTransform here only served to mark the session dirty
    // for merely clicking a piece — which design mode does automatically on
    // load, making the unsaved-changes guard fire on an untouched session.
    if (this.onSelect) this.onSelect(id);
  }

  detach() {
    this.selectedId = null;
    this.tc.detach();
  }

  setMode(mode) {
    this.tc.setMode(mode);
  }

  get selected() {
    return this.selectedId;
  }

  transformOf(id) {
    const mesh = this.meshes.get(id);
    return mesh ? transformToArray(mesh) : null;
  }

  applyTransform(id, t) {
    const mesh = this.meshes.get(id);
    if (!mesh) return;
    mesh.position.set(t.position[0], t.position[1], t.position[2]);
    mesh.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
    mesh.scale.set(t.scale[0], t.scale[1], t.scale[2]);
    if (this.selectedId === id && this.onTransform) {
      this.onTransform(id, this.transformOf(id));
    }
  }

  handlePointerDown(e) {
    if (!this.enabled || e.button !== 0) return;
    const hit = this.pick(e);
    if (hit) {
      this.select(hit);
      return;
    }
    if (this.hitGizmo(e)) return;
    this.detach();
  }

  pick(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const targets = Array.from(this.meshes.values()).filter((m) => m.visible);
    const hits = raycaster.intersectObjects(targets, false);
    return hits.length ? hits[0].object.userData.pieceId : null;
  }

  hitGizmo(e) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    const gizmo = this.tc.getHelper();
    return raycaster.intersectObject(gizmo, true).length > 0;
  }
}
