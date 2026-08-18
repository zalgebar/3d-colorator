// The global palette editor (owner only).
//
// This is the only place colors are created. Pieces reference colors by id, so
// renaming or re-mixing one here updates every piece using it, immediately.
// 03-ui-behavior.md#palette-editor-owner

import { paintSwatch } from "./swatch.js";
import { toast } from "./toast.js";

const HEX_RE = /^[0-9a-fA-F]{6}$/;

export function slugId(name, taken) {
  const base = String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "color";
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(base + "_" + n)) n++;
  return base + "_" + n;
}

export class PaletteEditor {
  constructor(els, ctx) {
    this.els = els;
    this.ctx = ctx; // { getPalette, onColorChanged, onPaletteStructureChanged, usageOf, removeColor }
    this.pendingDelete = null;
    this.wire();
  }

  wire() {
    this.els.btnOpenPalette.addEventListener("click", () => this.open());
    this.els.btnPaletteClose.addEventListener("click", () => this.els.paletteDialog.close());
    this.els.btnAddColor.addEventListener("click", () => this.addColor());
    this.els.btnColorDeleteCancel.addEventListener("click", () => this.els.colorDeleteDialog.close());
    this.els.btnColorDeleteConfirm.addEventListener("click", () => {
      this.els.colorDeleteDialog.close();
      if (this.pendingDelete) this.commitDelete(this.pendingDelete);
      this.pendingDelete = null;
    });
  }

  open() {
    this.render();
    this.els.paletteDialog.showModal();
  }

  render() {
    const palette = this.ctx.getPalette();
    if (!palette) return;
    const label = palette.colors.length + " color" + (palette.colors.length === 1 ? "" : "s");
    this.els.paletteCount.textContent = label;
    this.els.paletteCountInline.textContent = "Edit colors… (" + label + ")";

    const list = this.els.paletteList;
    list.innerHTML = "";
    palette.colors.forEach((color) => list.appendChild(this.row(color)));
  }

  row(color) {
    const row = document.createElement("div");
    row.className = "pal-row";
    row.dataset.colorId = color.id;
    const main = document.createElement("div");
    main.className = "pal-main";
    const meta = document.createElement("div");
    meta.className = "pal-meta";
    row.append(main, meta);

    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "⠿";
    grip.title = "Drag to reorder";
    this.attachDrag(grip, row);
    main.appendChild(grip);

    const sw = document.createElement("span");
    sw.className = "sw";
    Object.assign(sw.style, { width: "24px", height: "24px", borderRadius: "6px", border: "1px solid var(--border)" });
    paintSwatch(sw, color);
    main.appendChild(sw);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "pal-name";
    name.value = color.name;
    name.spellcheck = false;
    name.title = "Display name — safe to change, the id never moves";
    name.addEventListener("input", () => {
      color.name = name.value;
      this.ctx.onColorChanged(color, { nameOnly: true });
    });
    main.appendChild(name);

    // hex picker and text field, kept in sync
    const hexWrap = document.createElement("span");
    hexWrap.className = "hex-field";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = color.hex;
    const hash = document.createElement("span");
    hash.className = "hash";
    hash.textContent = "#";
    const hex = document.createElement("input");
    hex.type = "text";
    hex.value = color.hex.slice(1);
    hex.spellcheck = false;
    hex.maxLength = 6;

    const setHex = (value, from) => {
      if (!HEX_RE.test(value)) return;
      color.hex = ("#" + value).toLowerCase();
      if (from !== "picker") picker.value = color.hex;
      if (from !== "text") hex.value = color.hex.slice(1);
      paintSwatch(sw, color);
      this.ctx.onColorChanged(color);
    };
    picker.addEventListener("input", () => setHex(picker.value.slice(1), "picker"));
    hex.addEventListener("input", () => setHex(hex.value.trim(), "text"));
    hex.addEventListener("blur", () => (hex.value = color.hex.slice(1)));
    hexWrap.append(picker, hash, hex);
    meta.appendChild(hexWrap);

    const op = document.createElement("span");
    op.className = "op-cell";
    const opIn = document.createElement("input");
    opIn.type = "number";
    opIn.min = 0;
    opIn.max = 100;
    opIn.step = 1;
    opIn.value = Math.round(color.opacity * 100);
    const applyOpacity = (commit) => {
      let v = parseInt(opIn.value, 10);
      if (isNaN(v)) {
        if (!commit) return;
        v = Math.round(color.opacity * 100);
      }
      v = Math.max(0, Math.min(100, v));
      if (commit) opIn.value = v;
      color.opacity = v / 100;
      paintSwatch(sw, color);
      this.ctx.onColorChanged(color);
    };
    opIn.addEventListener("input", () => applyOpacity(false));
    opIn.addEventListener("blur", () => applyOpacity(true));
    const pct = document.createElement("span");
    pct.className = "pct";
    pct.textContent = "%";
    op.append(opIn, pct);
    meta.appendChild(op);

    const del = document.createElement("button");
    del.type = "button";
    del.className = "icon-btn danger";
    del.textContent = "✕";
    del.title = "Delete color";
    del.addEventListener("click", () => this.requestDelete(color));
    main.appendChild(del);

    // the id is what share links carry, so make it discoverable but quiet
    const id = document.createElement("span");
    id.className = "pal-id";
    id.textContent = color.id;
    meta.appendChild(id);

    return row;
  }

  addColor() {
    const palette = this.ctx.getPalette();
    const taken = new Set(palette.ids);
    const color = { id: slugId("New Color", taken), name: "New Color", hex: "#4f8cff", opacity: 1 };
    palette.colors.push(color);
    palette._byId.set(color.id, color);
    this.render();
    this.ctx.onPaletteStructureChanged();
    const row = this.els.paletteList.lastElementChild;
    if (row) {
      row.scrollIntoView({ block: "nearest" });
      const name = row.querySelector(".pal-name");
      name.focus();
      name.select();
    }
    toast("Added color (id: " + color.id + ")");
  }

  requestDelete(color) {
    const users = this.ctx.usageOf(color.id);
    if (!users.length) {
      this.commitDelete(color);
      return;
    }
    this.pendingDelete = color;
    this.els.colorDeleteMsg.innerHTML =
      "<b>" + color.name + "</b> is offered by " + users.length + " piece" +
      (users.length === 1 ? "" : "s") +
      ", and may appear in links people have already shared. It will be removed from the palette and from every piece that offers it.";
    this.els.colorDeleteUses.textContent = users.map((p) => p.label).join(" · ");
    this.els.colorDeleteDialog.showModal();
  }

  commitDelete(color) {
    const summary = this.ctx.removeColor(color.id);
    this.render();
    toast(
      "Deleted " + color.name +
        (summary.reassigned ? " — " + summary.reassigned + " piece default reassigned" : "")
    );
  }

  // Pointer-based reorder. Document-level listeners with a movement threshold:
  // moving the dragged node can drop a pointer capture mid-drag.
  attachDrag(handle, row) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const list = row.parentElement;
      const startY = e.clientY;
      let dragging = false;

      const move = (ev) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 4) return;
          dragging = true;
          row.classList.add("dragging");
        }
        const others = [...list.querySelectorAll(".pal-row:not(.dragging)")];
        let after = null;
        for (const s of others) {
          const b = s.getBoundingClientRect();
          if (ev.clientY < b.top + b.height / 2) {
            after = s;
            break;
          }
        }
        if (after) list.insertBefore(row, after);
        else list.appendChild(row);
      };

      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (!dragging) return;
        row.classList.remove("dragging");
        const order = [...list.children].map((r) => r.dataset.colorId);
        const palette = this.ctx.getPalette();
        palette.colors.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
        this.ctx.onPaletteStructureChanged();
        toast("Palette reordered");
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }
}
