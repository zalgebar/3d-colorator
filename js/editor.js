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
  }

  // Pieces are looked up in the live scene graph rather than from an index.
  //
  // The index used to be built once when a print loaded, so a mesh added after
  // that — a duplicate — was invisible to both select() and the raycaster, and
  // invisible in the worst way: select() found nothing and simply returned, so
  // clicking a fresh copy did nothing at all and said nothing about it. Every
  // future path that adds or removes a mesh would have had to remember to
  // reindex. A print has a handful of meshes, so walking them per click costs
  // nothing next to the class of bug it removes.
  meshFor(id) {
    if (!this.group) return null;
    let found = null;
    this.group.traverse((o) => {
      if (!found && o.isMesh && o.userData.pieceId === id) found = o;
    });
    return found;
  }

  // Only the front-face mesh of each piece carries a pieceId; the back-face
  // pass is a child without one, so it never becomes a click target.
  pickTargets() {
    const out = [];
    if (this.group) {
      this.group.traverse((o) => {
        if (o.isMesh && o.userData.pieceId && o.visible) out.push(o);
      });
    }
    return out;
  }

  setEnabled(on) {
    this.enabled = on;
    this.tc.enabled = on;
    if (!on) this.detach();
  }

  select(id) {
    if (!this.enabled) return;
    const mesh = this.meshFor(id);
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
    if (this.selectedId === null) return;
    this.selectedId = null;
    this.tc.detach();
    // Deselecting is a selection change too. Without this, every caller had to
    // remember to clear the transform panel itself, and none of them cleared
    // all of it — so deleting, hiding, or clicking away from a piece left the
    // panel showing that piece's name and its stale numbers.
    if (this.onSelect) this.onSelect(null);
  }

  setMode(mode) {
    this.tc.setMode(mode);
  }

  get selected() {
    return this.selectedId;
  }

  transformOf(id) {
    const mesh = this.meshFor(id);
    return mesh ? transformToArray(mesh) : null;
  }

  applyTransform(id, t) {
    const mesh = this.meshFor(id);
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
    const targets = this.pickTargets();
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
