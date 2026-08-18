// The sidebar piece list.
//
// Visitors get one swatch dropdown per piece, listing exactly the colors that
// piece offers. The owner instead gets the subset editor: which palette colors
// this piece offers, in what order, and which is its default.
// Colors themselves are only ever created in the palette editor.
// 03-ui-behavior.md#piece-subset-editor-owner

import { paintSwatch, swatchTitle } from "./swatch.js";
import { toast } from "./toast.js";

const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<path class="lens" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
  "</svg>";

export function closeMenus() {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
}

function closeMenusOnOutside(e) {
  if (e.target.closest(".menu") || e.target.closest(".dd > button") || e.target.closest(".chip-add > button")) return;
  closeMenus();
}

export class PieceList {
  constructor(root, { onSelect, onColorChange, onVisibilityChange, onOfferingChange }) {
    this.root = root;
    this.onSelect = onSelect;
    this.onColorChange = onColorChange;
    this.onVisibilityChange = onVisibilityChange;
    this.onOfferingChange = onOfferingChange;
    this.print = null;
    this.palette = null;
    this.records = null;
    this.selectedId = null;
    this.designOn = false;
  }

  build(print, palette, records, designOn) {
    this.print = print;
    this.palette = palette;
    this.records = records;
    this.designOn = designOn;
    closeMenus();
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
      top.append(label, eye);
      row.appendChild(top);

      if (designOn) this.buildSubsetEditor(row, def);
      else row.appendChild(this.buildDropdown(def));

      row.addEventListener("click", (e) => {
        if (e.target.closest("button, .chips, .dd, input")) return;
        const rec = this.records.get(def.id);
        if (!rec || !rec.mesh.visible) return;
        if (this.designOn && this.onSelect) this.onSelect(def.id);
      });

      this.root.appendChild(row);
    });

    [...records.keys()].forEach((id) => this.updateEye(id));
    this.updateSelection(this.selectedId);
  }

  // ---- visitor: one dropdown of the piece's offered colors ----

  buildDropdown(def) {
    const rec = this.records.get(def.id);
    const dd = document.createElement("span");
    dd.className = "dd";

    const btn = document.createElement("button");
    btn.type = "button";
    const sw = document.createElement("span");
    sw.className = "dd-sw";
    const nm = document.createElement("span");
    nm.className = "nm";
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▾";
    btn.append(sw, nm, caret);

    const paint = () => {
      const current = this.records.get(def.id).color;
      const color = this.palette.resolve(current);
      paintSwatch(sw, color);
      nm.textContent = color.name;
      btn.title = swatchTitle(color);
    };
    paint();
    dd.paint = paint;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = dd.querySelector(".menu");
      closeMenus();
      if (open) return;
      const menu = document.createElement("div");
      menu.className = "menu";
      this.palette.offeredIds(def).forEach((colorId) => {
        const color = this.palette.resolve(colorId);
        const mi = document.createElement("div");
        mi.className = "mi";
        const msw = document.createElement("span");
        msw.className = "dd-sw";
        paintSwatch(msw, color);
        const mnm = document.createElement("span");
        mnm.className = "nm";
        mnm.textContent = color.name;
        mi.append(msw, mnm);
        if (colorId === this.records.get(def.id).color) {
          const ck = document.createElement("span");
          ck.className = "ck";
          ck.textContent = "✓";
          mi.appendChild(ck);
        }
        mi.title = swatchTitle(color);
        mi.addEventListener("click", () => {
          closeMenus();
          if (this.onColorChange) this.onColorChange(def.id, colorId);
          paint();
        });
        menu.appendChild(mi);
      });
      dd.appendChild(menu);
      setTimeout(() => document.addEventListener("pointerdown", closeMenusOnOutside, { once: true }), 0);
    });

    dd.appendChild(btn);
    return dd;
  }

  // ---- owner: which colors this piece offers ----

  buildSubsetEditor(row, def) {
    const restricted = def.palette.length > 0;

    const offer = document.createElement("div");
    offer.className = "offer-row";
    const seg = document.createElement("span");
    seg.className = "seg";
    const bAll = document.createElement("button");
    bAll.type = "button";
    bAll.textContent = "Offer all";
    if (!restricted) bAll.className = "active";
    const bRestrict = document.createElement("button");
    bRestrict.type = "button";
    bRestrict.textContent = "Restrict";
    if (restricted) bRestrict.className = "active";
    bAll.addEventListener("click", (e) => {
      e.stopPropagation();
      def.palette = [];
      this.onOfferingChange(def.id);
    });
    bRestrict.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!def.palette.length) def.palette = this.palette.ids.slice();
      this.onOfferingChange(def.id);
    });
    seg.append(bAll, bRestrict);
    offer.appendChild(seg);

    const note = document.createElement("span");
    note.className = "offer-note";
    note.innerHTML = restricted
      ? def.palette.length + " offered · drag to reorder"
      : "<b>Offer All</b> — no colors selected";
    offer.appendChild(note);
    row.appendChild(offer);

    const chips = document.createElement("div");
    chips.className = "chips" + (restricted ? "" : " implicit");
    this.palette.offeredIds(def).forEach((colorId) => {
      chips.appendChild(this.makeChip(def, colorId, chips, restricted));
    });

    if (restricted) {
      const remaining = this.palette.ids.filter((id) => !def.palette.includes(id));
      const add = document.createElement("span");
      add.className = "chip-add";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.textContent = "+ add ▾";
      addBtn.disabled = remaining.length === 0;
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openAddMenu(add, def, remaining);
      });
      add.appendChild(addBtn);
      chips.appendChild(add);
    }
    row.appendChild(chips);

    if (restricted) {
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "linky";
      reset.textContent = "↺ Offer all instead";
      reset.addEventListener("click", (e) => {
        e.stopPropagation();
        def.palette = [];
        this.onOfferingChange(def.id);
      });
      row.appendChild(reset);
    }
  }

  makeChip(def, colorId, container, restricted) {
    const rec = this.records.get(def.id);
    const color = this.palette.resolve(colorId);
    const isDefault = rec && rec.color === colorId;

    const chip = document.createElement("span");
    chip.className = "chip" + (isDefault ? " is-default" : "");
    chip.dataset.color = colorId;
    chip.title = swatchTitle(color) + (isDefault ? " — this piece's default" : " — click to make default");

    const star = document.createElement("span");
    star.className = "star";
    star.textContent = isDefault ? "★" : "☆";
    const sw = document.createElement("span");
    sw.className = "chip-sw";
    paintSwatch(sw, color);
    chip.append(star, sw);
    // In "offer all" you are not curating, so chips collapse to swatches — with
    // 15 colors across several pieces, named chips make the sidebar unusable.
    if (restricted) {
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = color.name;
      chip.appendChild(nm);
    } else {
      chip.classList.add("compact");
    }

    // Clicking a chip makes it the piece's default — which is also the color
    // shown in the viewport and written out as defaultColor.
    chip.addEventListener("click", (e) => {
      if (e.target.closest(".rm")) return;
      e.stopPropagation();
      if (this.onColorChange) this.onColorChange(def.id, colorId);
      this.refreshChips(def.id);
    });

    if (restricted) {
      const rm = document.createElement("span");
      rm.className = "rm";
      rm.textContent = "✕";
      rm.title = "Remove from this piece";
      rm.addEventListener("click", (e) => {
        e.stopPropagation();
        if (def.palette.length <= 1) {
          toast("A piece must offer at least one color", true);
          return;
        }
        def.palette = def.palette.filter((c) => c !== colorId);
        this.onOfferingChange(def.id);
      });
      chip.appendChild(rm);
    }

    this.attachChipDrag(chip, def, container, !restricted);
    return chip;
  }

  openAddMenu(anchor, def, remaining) {
    closeMenus();
    const menu = document.createElement("div");
    menu.className = "menu";
    remaining.forEach((colorId) => {
      const color = this.palette.resolve(colorId);
      const mi = document.createElement("div");
      mi.className = "mi";
      const sw = document.createElement("span");
      sw.className = "dd-sw";
      paintSwatch(sw, color);
      const nm = document.createElement("span");
      nm.className = "nm";
      nm.textContent = color.name;
      mi.append(sw, nm);
      mi.addEventListener("click", () => {
        closeMenus();
        def.palette.push(colorId);
        this.onOfferingChange(def.id);
      });
      menu.appendChild(mi);
    });
    // Where the paid off-palette request will live once custom colors ship.
    const reserved = document.createElement("div");
    reserved.className = "mi reserved";
    reserved.textContent = "Custom color… (planned)";
    menu.appendChild(reserved);
    anchor.appendChild(menu);
    setTimeout(() => document.addEventListener("pointerdown", closeMenusOnOutside, { once: true }), 0);
  }

  // Stable insertion: among chips on the cursor's row, insert before the first
  // whose centre is right of the pointer. Monotonic, so neighbours reflowing
  // under the cursor cannot oscillate the drop target.
  attachChipDrag(chip, def, container, promote) {
    chip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || e.target.closest(".rm")) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragging = false;

      const move = (ev) => {
        if (!dragging) {
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
          dragging = true;
          chip.classList.add("dragging");
        }
        const others = [...container.querySelectorAll(".chip:not(.dragging)")];
        const sameRow = others.filter((s) => {
          const b = s.getBoundingClientRect();
          return ev.clientY >= b.top && ev.clientY <= b.bottom;
        });
        const pool = sameRow.length ? sameRow : others;
        let best = { off: -Infinity, el: null };
        for (const s of pool) {
          const b = s.getBoundingClientRect();
          const off = ev.clientX - (b.left + b.width / 2);
          if (off < 0 && off > best.off) best = { off, el: s };
        }
        const ref = best.el || container.querySelector(".chip-add") || null;
        if (chip.nextElementSibling !== ref) container.insertBefore(chip, ref);
      };

      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        if (!dragging) return;
        chip.classList.remove("dragging");
        const order = [...container.querySelectorAll(".chip")].map((c) => c.dataset.color);
        // Reordering an implicit "offer all" list is a decision to curate it.
        def.palette = order;
        this.onOfferingChange(def.id);
        toast(promote ? "Now restricted to this order" : "Reordered offered colors");
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }

  // ---- shared state ----

  rowFor(id) {
    return this.root.querySelector('.piece-row[data-piece-id="' + id + '"]');
  }

  refreshChips(id) {
    const row = this.rowFor(id);
    const rec = this.records.get(id);
    if (!row || !rec) return;
    row.querySelectorAll(".chip").forEach((chip) => {
      const isDefault = chip.dataset.color === rec.color;
      chip.classList.toggle("is-default", isDefault);
      chip.querySelector(".star").textContent = isDefault ? "★" : "☆";
    });
  }

  // Repaint a piece's control after its color changed elsewhere.
  syncPiece(id) {
    const row = this.rowFor(id);
    if (!row) return;
    const dd = row.querySelector(".dd");
    if (dd && dd.paint) dd.paint();
    else this.refreshChips(id);
  }

  syncActive() {
    [...this.root.children].forEach((row) => this.syncPiece(row.dataset.pieceId));
  }

  // A palette edit can change any color's appearance or name, so repaint all.
  repaintColors() {
    this.syncActive();
    if (this.designOn && this.print) {
      this.build(this.print, this.palette, this.records, true);
    }
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
    row.querySelectorAll(".dd > button").forEach((el) => (el.disabled = !rec.mesh.visible));
    row.classList.toggle("dimmed", !rec.mesh.visible);
  }

  updateSelection(selectedId) {
    this.selectedId = selectedId;
    [...this.root.children].forEach((row) => {
      row.classList.toggle("selected", row.dataset.pieceId === selectedId);
    });
  }
}
