// The sidebar piece list.
//
// Visitors get one swatch dropdown per piece, listing exactly the colors that
// piece offers. The owner instead gets the subset editor: which palette colors
// this piece offers, in what order, and which is its default.
// Colors themselves are only ever created in the palette editor.
// 03-ui-behavior.md#piece-subset-editor-owner

import { paintSwatch, swatchTitle } from "./swatch.js";
import { toast } from "./toast.js";
import { openFloatingMenu, closeMenus } from "./menu.js";

export { closeMenus };

const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<path class="lens" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
  "</svg>";

export class PieceList {
  constructor(root, dialogEls, { onSelect, onColorChange, onVisibilityChange, onOfferingChange }) {
    this.root = root;
    this.dialogEls = dialogEls; // { dialog, title, body, close }
    this.openPieceId = null;
    if (dialogEls) {
      dialogEls.close.addEventListener("click", () => dialogEls.dialog.close());
      dialogEls.dialog.addEventListener("close", () => (this.openPieceId = null));
    }
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

      if (designOn) row.appendChild(this.buildColorsButton(def));
      else row.appendChild(this.buildDropdown(def));

      row.addEventListener("click", (e) => {
        if (e.target.closest("button, .subset-list, .dd, input")) return;
        const rec = this.records.get(def.id);
        if (!rec || !rec.mesh.visible) return;
        if (this.designOn && this.onSelect) this.onSelect(def.id);
      });

      this.root.appendChild(row);
    });

    [...records.keys()].forEach((id) => this.updateEye(id));
    this.updateSelection(this.selectedId);
    if (this.openPieceId) this.renderPieceDialog(this.openPieceId);
  }

  // ---- owner: launcher + dialog ----

  buildColorsButton(def) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "piece-colors-btn";
    const sw = document.createElement("span");
    sw.className = "dd-sw";
    const nm = document.createElement("span");
    nm.className = "nm";
    const count = document.createElement("span");
    count.className = "count";
    const caret = document.createElement("span");
    caret.className = "caret";
    caret.textContent = "▸";
    btn.append(sw, nm, count, caret);
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.openPieceColors(def);
    });
    this.paintColorsButton(btn, def);
    return btn;
  }

  // Kept separate from construction: the default color changes without the row
  // being rebuilt, and the launcher is what shows it in the sidebar.
  paintColorsButton(btn, def) {
    const rec = this.records.get(def.id);
    const color = this.palette.resolve(rec ? rec.color : def.defaultColor);
    paintSwatch(btn.querySelector(".dd-sw"), color);
    btn.querySelector(".nm").textContent = color.name;
    btn.querySelector(".count").textContent = def.palette.length
      ? this.palette.offeredIds(def).length + " offered"
      : "all";
    btn.title = "Edit which colors " + def.label + " offers";
  }

  openPieceColors(def) {
    if (!this.dialogEls) return;
    this.openPieceId = def.id;
    this.renderPieceDialog(def.id);
    this.dialogEls.dialog.showModal();
  }

  renderPieceDialog(pieceId) {
    const def = this.print && this.print.pieces.find((p) => p.id === pieceId);
    if (!def || !this.dialogEls) return;
    this.dialogEls.title.textContent = def.label;
    this.dialogEls.body.innerHTML = "";
    this.buildSubsetEditor(this.dialogEls.body, def);
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
      if (document.querySelector(".menu")) {
        closeMenus();
        return;
      }
      openFloatingMenu(btn, (menu) => {
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
      });
    });

    dd.appendChild(btn);
    return dd;
  }

  // ---- owner: which colors this piece offers ----

  buildSubsetEditor(container, def) {
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
    bAll.addEventListener("click", () => {
      def.palette = [];
      this.onOfferingChange(def.id);
    });
    bRestrict.addEventListener("click", () => {
      if (!def.palette.length) def.palette = this.palette.ids.slice();
      this.onOfferingChange(def.id);
    });
    seg.append(bAll, bRestrict);
    offer.appendChild(seg);

    const note = document.createElement("span");
    note.className = "offer-note";
    // Reordering is only meaningful under Restrict: "offer all in a custom
    // order" would have to be stored as an explicit list, which *is* Restrict.
    // Rather than silently switching mode under the user, drag is simply not
    // offered here.
    note.innerHTML = restricted
      ? def.palette.length + " offered · drag to reorder"
      : "All " + this.palette.colors.length + " colors, in palette order";
    offer.appendChild(note);
    container.appendChild(offer);

    const list = document.createElement("div");
    list.className = "subset-list";
    this.palette.offeredIds(def).forEach((colorId) => {
      list.appendChild(this.makeSubsetRow(def, colorId, list, restricted));
    });
    container.appendChild(list);

    // The action area is rendered in both modes — occupied under Restrict,
    // holding an explanatory hint under Offer all — so switching tabs does not
    // change the dialog's height.
    const actions = document.createElement("div");
    actions.className = "subset-actions";

    if (restricted) {
      const remaining = this.palette.ids.filter((id) => !def.palette.includes(id));

      const add = document.createElement("span");
      add.className = "subset-add";
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn";
      addBtn.textContent = "+ Add a color";
      addBtn.disabled = remaining.length === 0;
      addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openAddMenu(add, def, remaining);
      });
      add.appendChild(addBtn);
      actions.appendChild(add);

      // Distinct from the "Offer all" tab: that discards the explicit list,
      // this tops it up while keeping the order already curated.
      const addAll = document.createElement("button");
      addAll.type = "button";
      addAll.className = "btn";
      addAll.textContent = "Add remaining (" + remaining.length + ")";
      addAll.disabled = remaining.length === 0;
      addAll.title = "Append every palette color this piece does not offer yet, keeping the current order";
      addAll.addEventListener("click", () => {
        def.palette = def.palette.concat(remaining);
        this.onOfferingChange(def.id);
        toast("Added " + remaining.length + " color" + (remaining.length === 1 ? "" : "s"));
      });
      actions.appendChild(addAll);
    } else {
      const hint = document.createElement("span");
      hint.className = "subset-hint";
      hint.textContent = "Switch to Restrict to choose colors or set their order.";
      actions.appendChild(hint);
    }
    container.appendChild(actions);
  }

  // One full-width row per color, matching what the visitor sees in the
  // dropdown. Uniform height means reordering can never resize the dialog.
  makeSubsetRow(def, colorId, list, restricted) {
    const rec = this.records.get(def.id);
    const color = this.palette.resolve(colorId);
    const isDefault = rec && rec.color === colorId;

    const row = document.createElement("div");
    row.className = "subset-row" + (isDefault ? " is-default" : "");
    row.dataset.color = colorId;
    row.title = isDefault ? "This piece's default" : "Click to make this the default";

    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = restricted ? "⠿" : "";
    if (restricted) {
      grip.title = "Drag to reorder";
      this.attachSubsetDrag(grip, row, def, list);
    } else {
      grip.classList.add("inert");
    }
    row.appendChild(grip);

    const sw = document.createElement("span");
    sw.className = "dd-sw";
    paintSwatch(sw, color);
    row.appendChild(sw);

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = color.name;
    row.appendChild(nm);

    if (color.opacity < 1) {
      const op = document.createElement("span");
      op.className = "op";
      op.textContent = Math.round(color.opacity * 100) + "%";
      row.appendChild(op);
    }

    const star = document.createElement("span");
    star.className = "star";
    star.textContent = isDefault ? "★" : "☆";
    row.appendChild(star);

    if (restricted) {
      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "icon-btn danger rm";
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
      row.appendChild(rm);
    } else {
      const spacer = document.createElement("span");
      spacer.className = "rm-spacer";
      spacer.setAttribute("aria-hidden", "true");
      row.appendChild(spacer);
    }

    // Clicking the row makes it the piece's default — the color shown in the
    // viewport and written out as defaultColor.
    row.addEventListener("click", (e) => {
      if (e.target.closest(".rm, .grip")) return;
      if (this.onColorChange) this.onColorChange(def.id, colorId);
    });

    return row;
  }

  openAddMenu(anchor, def, remaining) {
    openFloatingMenu(anchor.querySelector("button") || anchor, (menu) => {
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
    });
  }

  // Vertical reorder, same shape as the palette editor: document-level
  // listeners with a movement threshold, and a single midpoint comparison per
  // sibling so the drop target can only move one way as the pointer travels.
  attachSubsetDrag(handle, row, def, list) {
    handle.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startY = e.clientY;
      let dragging = false;

      const move = (ev) => {
        if (!dragging) {
          if (Math.abs(ev.clientY - startY) < 4) return;
          dragging = true;
          row.classList.add("dragging");
        }
        let after = null;
        for (const other of list.querySelectorAll(".subset-row:not(.dragging)")) {
          const b = other.getBoundingClientRect();
          if (ev.clientY < b.top + b.height / 2) {
            after = other;
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
        def.palette = [...list.querySelectorAll(".subset-row")].map((r) => r.dataset.color);
        this.onOfferingChange(def.id);
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }


  // ---- shared state ----

  rowFor(id) {
    return this.root.querySelector('.piece-row[data-piece-id="' + id + '"]');
  }

  // The offered-color rows live in the dialog, not the sidebar row.
  refreshChips(id) {
    const rec = this.records.get(id);
    if (!rec || !this.dialogEls || this.openPieceId !== id) return;
    this.dialogEls.body.querySelectorAll(".subset-row").forEach((row) => {
      const isDefault = row.dataset.color === rec.color;
      row.classList.toggle("is-default", isDefault);
      row.querySelector(".star").textContent = isDefault ? "★" : "☆";
      row.title = isDefault ? "This piece's default" : "Click to make this the default";
    });
  }

  // Repaint every surface showing a piece's color: the visitor dropdown, the
  // owner's row launcher, and the rows in the open dialog.
  syncPiece(id) {
    const def = this.print && this.print.pieces.find((p) => p.id === id);
    const row = this.rowFor(id);
    if (row && def) {
      const dd = row.querySelector(".dd");
      if (dd && dd.paint) dd.paint();
      const btn = row.querySelector(".piece-colors-btn");
      if (btn) this.paintColorsButton(btn, def);
    }
    this.refreshChips(id);
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
