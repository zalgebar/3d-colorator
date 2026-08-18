// The sidebar piece list: one row per piece, with a color swatch strip and a
// visibility toggle. Colors are palette ids resolved through the Palette.
//
// Authoring the color *offering* (which colors a piece exposes) is not here —
// that is the palette + subset editor in Phase 3. This module only lets a
// visitor or the owner pick among the colors a piece already offers.

const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<path class="lens" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
  "</svg>";

export class PieceList {
  constructor(root, { onSelect, onColorChange, onVisibilityChange }) {
    this.root = root;
    this.onSelect = onSelect;
    this.onColorChange = onColorChange;
    this.onVisibilityChange = onVisibilityChange;
    this.palette = null;
    this.records = null;
    this.selectedId = null;
    this.designOn = false;
  }

  build(print, palette, records, designOn) {
    this.palette = palette;
    this.records = records;
    this.designOn = designOn;
    this.root.innerHTML = "";

    print.pieces.forEach((def) => {
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
        this.toggleVisible(def.id);
      });

      top.appendChild(label);
      top.appendChild(eye);
      row.appendChild(top);

      const swatches = document.createElement("div");
      swatches.className = "color-swatches";
      palette.offeredIds(def).forEach((colorId) => {
        swatches.appendChild(this.makeSwatch(def.id, colorId));
      });
      row.appendChild(swatches);

      row.addEventListener("click", () => {
        const rec = this.records.get(def.id);
        if (!rec || !rec.mesh.visible) return;
        if (this.designOn && this.onSelect) this.onSelect(def.id);
      });

      this.root.appendChild(row);
    });

    [...records.keys()].forEach((id) => this.updateEye(id));
    this.syncActive();
    this.updateSelection(this.selectedId);
  }

  makeSwatch(pieceId, colorId) {
    const color = this.palette.byId(colorId);
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "color-swatch";
    sw.style.background = color ? color.hex : "#cccccc";
    sw.dataset.color = colorId;
    sw.title = color ? color.name : colorId;
    sw.addEventListener("click", (e) => {
      e.stopPropagation();
      const rec = this.records.get(pieceId);
      if (!rec) return;
      if (this.onColorChange) this.onColorChange(pieceId, colorId);
      this.updateSwatchActive(pieceId);
    });
    return sw;
  }

  rowFor(id) {
    return this.root.querySelector('.piece-row[data-piece-id="' + id + '"]');
  }

  updateSwatchActive(id) {
    const rec = this.records.get(id);
    const row = this.rowFor(id);
    if (!row || !rec) return;
    row.querySelectorAll(".color-swatch").forEach((sw) => {
      sw.classList.toggle("active", sw.dataset.color === rec.color);
    });
  }

  syncActive() {
    [...this.root.children].forEach((row) => this.updateSwatchActive(row.dataset.pieceId));
  }

  toggleVisible(id) {
    const rec = this.records.get(id);
    if (!rec) return;
    rec.mesh.visible = !rec.mesh.visible;
    this.updateEye(id);
    if (this.onVisibilityChange) this.onVisibilityChange(id, rec.mesh.visible);
  }

  updateEye(id) {
    const rec = this.records.get(id);
    const row = this.rowFor(id);
    if (!row || !rec) return;
    row.querySelector(".piece-eye").classList.toggle("off", !rec.mesh.visible);
    row.querySelectorAll(".color-swatch").forEach((el) => (el.disabled = !rec.mesh.visible));
    row.classList.toggle("dimmed", !rec.mesh.visible);
  }

  updateSelection(selectedId) {
    this.selectedId = selectedId;
    [...this.root.children].forEach((row) => {
      row.classList.toggle("selected", row.dataset.pieceId === selectedId);
    });
  }
}
