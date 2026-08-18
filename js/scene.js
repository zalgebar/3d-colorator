// Everything that owns the three.js viewport: renderer, camera, lights, helpers,
// framing and the screenshot. Knows nothing about prints, palettes or the sidebar.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export class Viewer {
  constructor(canvas, { gridVisible = false, axesVisible = false } = {}) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 8000);
    this.camera.position.set(120, 90, -160);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a4050, 0.55));

    this.dirLight = new THREE.DirectionalLight(0xffffff, 2.4);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.0004;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    const fill = new THREE.DirectionalLight(0x7d9bff, 0.5);
    fill.position.set(-120, 60, -140);
    this.scene.add(fill);

    this.grid = new THREE.GridHelper(240, 24, 0x39414d, 0x232932);
    this.grid.position.y = -0.01;
    this.grid.visible = gridVisible;
    this.scene.add(this.grid);

    this.axes = new THREE.AxesHelper(30);
    this.axes.visible = axesVisible;
    this.scene.add(this.axes);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const wrap = this.canvas.parentElement;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  start() {
    const tick = () => {
      requestAnimationFrame(tick);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  clearGroup() {
    while (this.group.children.length) {
      const child = this.group.children[0];
      // geometry is owned by the print's GeometryCache, so only materials here.
      // Traverse: a translucent piece carries a back-face pass as a child.
      child.traverse((o) => {
        if (o.material) o.material.dispose();
      });
      this.group.remove(child);
    }
  }

  // Frames visible pieces and re-aims the shadow camera to match their size.
  frameView() {
    const box = new THREE.Box3();
    this.group.children.forEach((child) => {
      if (child.visible && child.geometry) box.expandByObject(child);
    });
    if (box.isEmpty()) box.setFromObject(this.group);
    if (box.isEmpty()) return;

    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center;
    const radius = Math.max(sphere.radius, 15);

    this.controls.target.copy(center);

    const dist = (radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.5;
    const dir = new THREE.Vector3(0.65, 0.5, -1).normalize();
    this.camera.position.copy(center).add(dir.multiplyScalar(dist));

    this.dirLight.position.copy(center).add(new THREE.Vector3(radius * 1.2, radius * 2, radius * 1.2));
    this.dirLight.target.position.copy(center);
    const s = radius * 1.6;
    const cam = this.dirLight.shadow.camera;
    cam.left = -s;
    cam.right = s;
    cam.top = s;
    cam.bottom = -s;
    cam.near = 0.1;
    cam.far = radius * 6;
    cam.updateProjectionMatrix();

    this.controls.update();
  }

  centerOnOrigin() {
    const offset = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(0, 0, 0);
    this.camera.position.copy(this.controls.target).add(offset);
    this.controls.update();
  }

  setGridVisible(on) {
    this.grid.visible = on;
  }

  setAxesVisible(on) {
    this.axes.visible = on;
  }

  // Left-drag is the transform gizmo in design mode, so orbit moves to right-drag.
  setDesignNavigation(on) {
    this.controls.mouseButtons = on
      ? { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
      : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
  }

  screenshot(filename, onDone) {
    this.renderer.render(this.scene, this.camera);
    this.renderer.domElement.toBlob((blob) => {
      if (!blob) {
        onDone(null);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      onDone(filename);
    }, "image/png");
  }
}
