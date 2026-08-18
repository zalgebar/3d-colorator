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

const CHAIN_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07l-1.4 1.41"/>' +
  '<path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 0 0 7.07 7.07l1.4-1.41"/></svg>';

const UNLINK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M9 17H7A5 5 0 0 1 7 7h2"/><path d="M15 7h2a5 5 0 0 1 3.4 8.6"/><line x1="3" y1="3" x2="21" y2="21"/></svg>';

const DUP_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="9" y="9" width="12" height="12" rx="2"/>' +
  '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

const LAYERS_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/>' +
  '<polyline points="2 12 12 17 22 12"/></svg>';

const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>' +
  '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>';

const EYE_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/>' +
  '<path class="lens" d="M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/>' +
  "</svg>";

export class PieceList {
  constructor(root, dialogEls, { onSelect, onColorChange, onVisibilityChange, onOfferingChange, links, pieces, linkBarEls }) {
    this.root = root;
    this.links = links;               // group mutations, owned by app.js
    this.pieceApi = pieces;           // duplicate / delete / rename, owned by app.js
    this.pieceInfoId = null;
    this.linkBarEls = linkBarEls;     // { bar, count, addSlot, newGroup }
    this.selected = new Set();
    this.expandedGroups = new Set();
    this.dialogEls = dialogEls; // { dialog, title, body, close, cancel }
    this.openPieceId = null;
    // Edits apply live so the viewport previews them, so the dialog keeps a
    // snapshot to restore if it is dismissed without saving.
    this.pieceSnapshot = null;
    this.stashedSubset = null;
    if (dialogEls) {
      dialogEls.close.addEventListener("click", () => this.closePieceDialog(true));
      dialogEls.cancel.addEventListener("click", () => this.closePieceDialog(false));
      // Escape reverts, like Cancel. Note this deliberately does not use the
      // dialog's own `close` event: it does not fire reliably everywhere, so
      // every dismissal path is routed through closePieceDialog() instead.
      dialogEls.dialog.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        this.closePieceDialog(false);
      });
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

    const rendered = new Set();
    print.pieces.forEach((def) => {
      if (rendered.has(def.id)) return;
      const group = this.links && this.links.groupOf(def.id);
      if (group) {
        group.members.forEach((id) => rendered.add(id));
        this.root.appendChild(this.buildGroup(group));
      } else {
        rendered.add(def.id);
        this.root.appendChild(this.buildPieceRow(def));
      }
    });
    this.syncLinkBar();

    [...records.keys()].forEach((id) => this.updateEye(id));
    this.updateSelection(this.selectedId);
    if (this.openPieceId) this.renderPieceDialog(this.openPieceId);
  }

  // ---- link groups ----

  buildGroup(group) {
    const box = document.createElement("div");
    box.className = "group";
    box.dataset.groupId = group.id;
    box.appendChild(this.designOn ? this.groupHeadOwner(group) : this.groupHeadVisitor(group));

    const body = document.createElement("div");
    body.className = "group-body";

    if (group.collapsed) {
      if (this.designOn) {
        body.appendChild(this.groupSummary(group));
        body.appendChild(this.groupExpander(group, body));
      } else {
        // the group name is already on the header line, so the visitor just
        // needs the one shared color control
        body.appendChild(this.buildGroupDropdown(group));
      }
    } else {
      group.members.forEach((id) => {
        const def = this.print.pieces.find((p) => p.id === id);
        if (def) body.appendChild(this.buildPieceRow(def, { inGroup: group }));
      });
    }

    box.appendChild(body);
    return box;
  }

  groupHeadOwner(group) {
    const head = document.createElement("div");
    head.className = "group-head";

    const chain = document.createElement("span");
    chain.className = "chain";
    chain.innerHTML = CHAIN_SVG;
    head.appendChild(chain);

    const name = document.createElement("input");
    name.type = "text";
    name.className = "group-name";
    name.value = group.label;
    name.placeholder = "Name this group";
    name.spellcheck = false;
    head.appendChild(name);

    // Shown as a field because a collapsed group's id is the key in a share
    // link. It follows the name only while it is still an untouched placeholder.
    const idWrap = document.createElement("span");
    idWrap.className = "id-field";
    const idLabel = document.createElement("span");
    idLabel.className = "id-label";
    idLabel.textContent = "id";
    const idIn = document.createElement("input");
    idIn.type = "text";
    idIn.value = group.id;
    idIn.spellcheck = false;
    idIn.title = "Used as the share-link key when this group is collapsed";
    idIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") idIn.blur();
    });
    idIn.addEventListener("blur", () => {
      const next = idIn.value.trim();
      if (next === group.id) return;
      const problem = this.links.renameId(group.id, next);
      if (problem) {
        idIn.value = group.id;
        toast(problem, true);
        return;
      }
      group.id = next;
      const box = idIn.closest(".group");
      if (box) box.dataset.groupId = next;
    });
    idWrap.append(idLabel, idIn);
    head.appendChild(idWrap);

    name.addEventListener("input", () => {
      // `group` is the live state object, so rename() mutates it in place —
      // the previous id has to be captured before the call to notice a change.
      const before = group.id;
      const settled = this.links.rename(before, name.value);
      if (settled && settled !== before) {
        idIn.value = settled;
        const box = idIn.closest(".group");
        if (box) box.dataset.groupId = settled;
      }
    });

    const seg = document.createElement("span");
    seg.className = "seg";
    const bCol = document.createElement("button");
    bCol.type = "button";
    bCol.textContent = "Collapsed";
    if (group.collapsed) bCol.className = "active";
    const bSep = document.createElement("button");
    bSep.type = "button";
    bSep.textContent = "Separate";
    if (!group.collapsed) bSep.className = "active";
    bCol.addEventListener("click", () => this.links.setCollapsed(group.id, true));
    bSep.addEventListener("click", () => this.links.setCollapsed(group.id, false));
    seg.append(bCol, bSep);
    head.appendChild(seg);

    const un = document.createElement("button");
    un.type = "button";
    un.className = "unlink-btn";
    un.innerHTML = UNLINK_SVG;
    un.title = "Dissolve this group";
    un.addEventListener("click", () => this.links.unlink(group.id));
    head.appendChild(un);

    return head;
  }

  groupHeadVisitor(group) {
    const head = document.createElement("div");
    head.className = "group-head";
    const chain = document.createElement("span");
    chain.className = "chain";
    chain.innerHTML = CHAIN_SVG;
    head.appendChild(chain);
    // A blank label shows no name at all — never a placeholder.
    if (group.label) {
      const nm = document.createElement("span");
      nm.className = "group-name-ro";
      nm.textContent = group.label;
      head.appendChild(nm);
    }
    const parts = document.createElement("span");
    parts.className = "parts";
    parts.textContent = "(" + group.members.length + " parts)";
    head.appendChild(parts);
    return head;
  }

  // Owner, collapsed: one line standing in for the whole group.
  groupSummary(group) {
    const row = document.createElement("div");
    row.className = "group-summary";
    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = "All parts";
    const parts = document.createElement("span");
    parts.className = "parts";
    parts.textContent = "(" + group.members.length + ")";
    row.append(nm, parts);

    const members = group.members.map((id) => this.records.get(id)).filter(Boolean);
    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "piece-eye" + (members.every((r) => r.mesh.visible) ? "" : " off");
    eye.innerHTML = EYE_SVG;
    eye.title = "Show / hide every part";
    eye.addEventListener("click", () => {
      const anyOn = members.some((r) => r.mesh.visible);
      group.members.forEach((id) => {
        const rec = this.records.get(id);
        if (rec && rec.mesh.visible === anyOn) this.toggleVisible(id);
      });
    });
    row.appendChild(eye);
    row.appendChild(this.buildGroupDropdown(group));
    return row;
  }

  groupExpander(group, body) {
    const open = this.expandedGroups.has(group.id);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "expander" + (open ? " open" : "");
    btn.innerHTML = '<span class="tw">▸</span> per-part colors, visibility &amp; transform';
    btn.addEventListener("click", () => {
      if (open) this.expandedGroups.delete(group.id);
      else this.expandedGroups.add(group.id);
      this.build(this.print, this.palette, this.records, this.designOn);
    });
    if (!open) return btn;

    const wrap = document.createElement("div");
    wrap.appendChild(btn);
    const members = document.createElement("div");
    members.className = "members";
    group.members.forEach((id) => {
      const def = this.print.pieces.find((p) => p.id === id);
      if (def) members.appendChild(this.buildPieceRow(def, { inGroup: group }));
    });
    wrap.appendChild(members);
    return wrap;
  }

  // One control for the whole group, limited to colors every member offers.
  buildGroupDropdown(group) {
    const offered = this.links.offeredIdsFor(group);
    return this.colorDropdown({
      offered,
      current: () => group.color,
      pick: (colorId) => this.onColorChange(group.members[0], colorId),
      key: "group:" + group.id,
    });
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

  closePieceDialog(save) {
    if (!save) this.revertPiece();
    this.openPieceId = null;
    this.pieceSnapshot = null;
    this.stashedSubset = null;
    this.dialogEls.dialog.close();
  }

  openPieceColors(def) {
    if (!this.dialogEls) return;
    // Safety net for any dismissal that bypassed closePieceDialog().
    if (this.pieceSnapshot && this.openPieceId) this.revertPiece();
    const rec = this.records.get(def.id);
    this.openPieceId = def.id;
    this.pieceSnapshot = {
      palette: def.palette.slice(),
      defaultColor: def.defaultColor,
      color: rec ? rec.color : null,
    };
    // Remembered across tab switches so flipping to Offer all and back does not
    // discard a curated subset.
    this.stashedSubset = def.palette.length ? def.palette.slice() : null;
    this.renderPieceDialog(def.id);
    this.dialogEls.dialog.showModal();
  }

  revertPiece() {
    const id = this.openPieceId;
    const snap = this.pieceSnapshot;
    if (!id || !snap) return;
    const def = this.print && this.print.pieces.find((p) => p.id === id);
    if (!def) return;
    def.palette = snap.palette.slice();
    def.defaultColor = snap.defaultColor;
    if (snap.color && this.onColorChange) this.onColorChange(id, snap.color);
    this.onOfferingChange(id);
  }

  renderPieceDialog(pieceId) {
    const def = this.print && this.print.pieces.find((p) => p.id === pieceId);
    if (!def || !this.dialogEls) return;
    this.dialogEls.title.textContent = def.label;
    this.dialogEls.body.innerHTML = "";
    this.buildSubsetEditor(this.dialogEls.body, def);
  }

  // One piece row — identical whether the piece stands alone or sits in a group.
  buildPieceRow(def, { inGroup = null } = {}) {
    const row = document.createElement("div");
    row.className = "piece-row";
    row.dataset.pieceId = def.id;

    const top = document.createElement("div");
    top.className = "piece-row-top";
    const tools = document.createElement("span");
    tools.className = "row-tools";

    if (this.designOn && this.links) top.appendChild(this.buildCheckbox(def.id));

    const label = document.createElement("div");
    label.className = "piece-label";
    label.textContent = def.label;
    top.appendChild(label);

    if (this.designOn && inGroup) {
      const un = document.createElement("button");
      un.type = "button";
      un.className = "unlink-btn";
      un.innerHTML = UNLINK_SVG;
      un.title = "Remove " + def.label + " from this group";
      un.addEventListener("click", (e) => {
        e.stopPropagation();
        this.links.removeMember(inGroup.id, def.id);
      });
      tools.appendChild(un);
    }

    // Duplication is a primary authoring action, so it sits on the row rather
    // than behind a menu. `⋯` keeps only the occasional things: id and STL path.
    if (this.designOn && this.pieceApi) {
      const inst = this.pieceApi.instanceIndex(def.id);
      if (inst.total > 1) {
        const badge = document.createElement("span");
        badge.className = "inst-badge row";
        badge.textContent = "⧉ " + inst.index + "/" + inst.total;
        badge.title = inst.file.split("/").pop() + " is used by " + inst.total + " pieces";
        top.appendChild(badge);
      }

      const acts = document.createElement("span");
      acts.className = "piece-actions";

      const dup = document.createElement("button");
      dup.type = "button";
      dup.className = "icon-btn dup";
      dup.innerHTML = DUP_SVG;
      dup.title = "Duplicate this piece once";
      dup.addEventListener("click", async (e) => {
        e.stopPropagation();
        const created = await this.pieceApi.duplicate(def.id, 1, false);
        if (created) toast("Added " + created[0].label);
      });

      const many = document.createElement("button");
      many.type = "button";
      many.className = "icon-btn dup";
      many.innerHTML = LAYERS_SVG;
      many.title = "Duplicate several, optionally linked…";
      many.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openDuplicateDialog(def);
      });

      const sole = !this.pieceApi.canDelete(def.id);
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn del";
      del.innerHTML = TRASH_SVG;
      del.disabled = sole;
      del.title = sole
        ? "This is the only instance of " + inst.file.split("/").pop() +
          " — remove the STL from the print instead"
        : "Remove this instance";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        const label = def.label;
        if (this.pieceApi.remove(def.id)) toast("Removed " + label);
      });

      const more = document.createElement("button");
      more.type = "button";
      more.className = "icon-btn";
      more.textContent = "⋯";
      more.title = "Piece id and STL file";
      more.addEventListener("click", (e) => {
        e.stopPropagation();
        this.openPieceInfo(def);
      });

      acts.append(dup, many, del, more);
      tools.appendChild(acts);
    }

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "piece-eye";
    eye.title = "Show / hide this piece";
    eye.innerHTML = EYE_SVG;
    eye.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleVisible(def.id);
    });
    tools.appendChild(eye);
    top.appendChild(tools);
    row.appendChild(top);

    if (this.designOn) row.appendChild(this.buildColorsButton(def));
    else row.appendChild(this.buildDropdown(def));

    row.addEventListener("click", (e) => {
      if (e.target.closest("button, .subset-list, .dd, input, .chk")) return;
      const rec = this.records.get(def.id);
      if (!rec || !rec.mesh.visible) return;
      if (this.designOn && this.onSelect) this.onSelect(def.id);
    });
    return row;
  }

  buildCheckbox(pieceId) {
    const on = this.selected.has(pieceId);
    const chk = document.createElement("span");
    chk.className = "chk" + (on ? " on" : "");
    chk.textContent = on ? "✓" : "";
    chk.title = "Select for linking";
    chk.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.selected.has(pieceId)) this.selected.delete(pieceId);
      else this.selected.add(pieceId);
      const row = this.rowFor(pieceId);
      if (row) {
        const box = row.querySelector(".chk");
        box.classList.toggle("on", this.selected.has(pieceId));
        box.textContent = this.selected.has(pieceId) ? "✓" : "";
      }
      this.syncLinkBar();
    });
    return chk;
  }

  // ---- visitor: one dropdown of the piece's offered colors ----

  buildDropdown(def) {
    return this.colorDropdown({
      offered: this.palette.offeredIds(def),
      current: () => this.records.get(def.id).color,
      pick: (colorId) => this.onColorChange(def.id, colorId),
      key: "piece:" + def.id,
    });
  }

  // Shared swatch dropdown. `current` is read lazily so a repaint always shows
  // the live value, which matters for a group where any member can change it.
  colorDropdown({ offered, current, pick, key }) {
    const dd = document.createElement("span");
    dd.className = "dd";
    dd.dataset.ddKey = key;

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
      const color = this.palette.resolve(current());
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
        offered.forEach((colorId) => {
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
          if (colorId === current()) {
            const ck = document.createElement("span");
            ck.className = "ck";
            ck.textContent = "✓";
            mi.appendChild(ck);
          }
          mi.title = swatchTitle(color);
          mi.addEventListener("click", () => {
            closeMenus();
            pick(colorId);
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
      if (def.palette.length) this.stashedSubset = def.palette.slice();
      def.palette = [];
      this.onOfferingChange(def.id);
    });
    bRestrict.addEventListener("click", () => {
      if (!def.palette.length) {
        def.palette = this.stashedSubset ? this.stashedSubset.slice() : this.palette.ids.slice();
      }
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
        this.stashedSubset = def.palette.slice();
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
        this.stashedSubset = def.palette.slice();
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
        this.stashedSubset = def.palette.slice();
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
        this.stashedSubset = def.palette.slice();
        this.onOfferingChange(def.id);
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    });
  }


  // ---- piece dialog: id, STL, duplication ----

  wirePieceInfo(els) {
    this.pieceEls = els;
    if (!els) return;
    els.close.addEventListener("click", () => els.dialog.close());

    els.idInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") els.idInput.blur();
    });
    els.idInput.addEventListener("blur", () => {
      const from = this.pieceInfoId;
      const next = els.idInput.value.trim();
      if (!from || next === from) return;
      const problem = this.pieceApi.renameId(from, next);
      if (problem) {
        els.idInput.value = from;
        toast(problem, true);
        return;
      }
      this.pieceInfoId = next;
      toast("id " + from + " → " + next);
    });

    els.dupCancel.addEventListener("click", () => els.dupDialog.close());
    els.dupCreate.addEventListener("click", async () => {
      let n = parseInt(els.dupCount.value, 10);
      if (isNaN(n) || n < 1) n = 1;
      n = Math.min(n, 24);
      const link = els.dupLink.checked;
      const target = this.duplicateTargetId;
      els.dupDialog.close();
      const created = await this.pieceApi.duplicate(target, n, link);
      if (created) toast("Added " + n + (link ? " linked" : "") + " cop" + (n === 1 ? "y" : "ies"));
    });
  }

  openDuplicateDialog(def) {
    const els = this.pieceEls;
    if (!els) return;
    this.duplicateTargetId = def.id;
    els.dupCount.value = 3;
    els.dupLink.checked = true;
    els.dupTitle.textContent = def.label;
    els.dupDialog.showModal();
  }

  pieceLabel(id) {
    const def = this.print && this.print.pieces.find((p) => p.id === id);
    return def ? def.label : "";
  }

  openPieceInfo(def) {
    if (!this.pieceEls) return;
    this.pieceInfoId = def.id;
    this.renderPieceInfo();
    this.pieceEls.dialog.showModal();
  }

  renderPieceInfo() {
    const els = this.pieceEls;
    const id = this.pieceInfoId;
    const def = this.print && this.print.pieces.find((p) => p.id === id);
    if (!els || !def) return;

    els.title.textContent = def.label;
    els.idInput.value = def.id;

    const inst = this.pieceApi.instanceIndex(def.id);
    const file = inst.file.split("/").pop();
    els.stl.innerHTML = "";
    const path = document.createElement("span");
    path.className = "path";
    path.textContent = file;
    els.stl.appendChild(path);
    els.stl.title = inst.file;

    els.instances.classList.toggle("hidden", inst.total < 2);
    els.instances.textContent = "⧉ " + inst.index + " of " + inst.total;

    const sole = !this.pieceApi.canDelete(def.id);
    els.dupHint.textContent = sole
      ? "Duplicating adds another instance of " + file + ", placed beside this one."
      : file + " is used by " + inst.total + " pieces. Each is placed and colored on its own.";
  }

  // ---- link bar ----

  // Selection is transient: anything no longer on screen is dropped so a stale
  // tick cannot be acted on after a rebuild.
  syncLinkBar() {
    const els = this.linkBarEls;
    if (!els || !this.links) return;
    [...this.selected].forEach((id) => {
      if (!this.rowFor(id)) this.selected.delete(id);
    });
    const n = this.selected.size;
    els.bar.classList.toggle("hidden", !this.designOn || n < 1);
    els.count.textContent = n;
    els.newGroup.disabled = n < 2;
    els.newGroup.textContent = n < 2 ? "Link (pick 2+)" : "Link into a group";

    els.addSlot.innerHTML = "";
    const groups = this.print ? this.print.links : [];
    if (!groups.length || n < 1) return;
    const wrap = document.createElement("span");
    wrap.className = "link-add-wrap";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn";
    btn.textContent = "Add to group ▾";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ids = [...this.selected];
      openFloatingMenu(btn, (menu) => {
        groups.forEach((g) => {
          const mi = document.createElement("div");
          mi.className = "mi";
          const chain = document.createElement("span");
          chain.className = "chain";
          chain.style.color = "var(--link)";
          chain.innerHTML = CHAIN_SVG;
          const nm = document.createElement("span");
          nm.className = "nm";
          nm.textContent = (g.label || "Unnamed group") + " · " + g.members.length + " parts";
          mi.append(chain, nm);
          mi.addEventListener("click", () => {
            closeMenus();
            this.selected.clear();
            this.links.addTo(g.id, ids);
          });
          menu.appendChild(mi);
        });
      });
    });
    wrap.appendChild(btn);
    els.addSlot.appendChild(wrap);
  }

  wireLinkBar() {
    const els = this.linkBarEls;
    if (!els || !this.links) return;
    els.newGroup.addEventListener("click", () => {
      const ids = [...this.selected];
      if (ids.length < 2) return;
      this.selected.clear();
      this.links.create(ids);
      toast("Linked " + ids.length + " pieces — name the group in its header");
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
    const group = this.links && this.links.groupOf(id);
    if (group) {
      const gdd = this.root.querySelector('.dd[data-dd-key="group:' + group.id + '"]');
      if (gdd && gdd.paint) gdd.paint();
    }
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

  // Every piece row, including those nested inside a group's body — not just
  // the list's direct children.
  allRows() {
    return [...this.root.querySelectorAll(".piece-row[data-piece-id]")];
  }

  syncActive() {
    this.allRows().forEach((row) => this.syncPiece(row.dataset.pieceId));
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
    this.allRows().forEach((row) => {
      row.classList.toggle("selected", row.dataset.pieceId === selectedId);
    });
  }
}
