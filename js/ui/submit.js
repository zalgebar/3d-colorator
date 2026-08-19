// Design export/import and the nostr submit dialog.
//
// The on-the-wire payload still uses v1 hex values so files exported by the
// pre-refactor app keep working in both directions. Phase 7 moves this to the
// v2 id-based payload with a palette snapshot.

import {
  hasExtension,
  getRecipient,
  resolveIdentity,
  sendDesign,
  buildDesignPayload,
  savedNsec,
  saveNsec,
  npubOf,
} from "../nostr.js";
import { toast } from "./toast.js";

const NT = window.NostrTools;
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Legacy designs store hex, the app now stores palette ids. Exact match first,
// then nearest by RGB distance so an old file still lands somewhere sensible.
export function colorIdForHex(palette, hex) {
  const want = String(hex).toLowerCase();
  const exact = palette.colors.find((c) => c.hex === want);
  if (exact) return { id: exact.id, exact: true };
  const target = rgb(want);
  let best = null;
  let bestD = Infinity;
  palette.colors.forEach((c) => {
    const p = rgb(c.hex);
    const d = Math.hypot(target[0] - p[0], target[1] - p[1], target[2] - p[2]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  });
  return best ? { id: best.id, exact: false } : null;
}

export class DesignIO {
  constructor(els, ctx) {
    this.els = els;
    this.ctx = ctx; // { getPrint, getRecords, getPalette, getCollection, setPieceColor }
    this.onetimeSk = null;
  }

  submitConfig() {
    return this.ctx.getCollection().submit;
  }

  // Palette ids, as stored — the snapshot below carries what they meant.
  currentColors() {
    const colors = {};
    this.ctx.getRecords().forEach((rec, id) => {
      colors[id] = rec.color;
    });
    return colors;
  }

  // Only the colors actually used. A submission is an order record, so it has
  // to survive the catalog being renamed or re-mixed afterwards (D8).
  snapshot(colors) {
    const palette = this.ctx.getPalette();
    const snap = {};
    Object.values(colors).forEach((id) => {
      if (snap[id]) return;
      const color = palette.byId(id);
      if (color) snap[id] = { name: color.name, hex: color.hex, opacity: color.opacity };
    });
    return snap;
  }

  payload(orderId, author) {
    const print = this.ctx.getPrint();
    const colors = this.currentColors();
    return buildDesignPayload({
      orderId: orderId || "",
      collection: this.ctx.getCollection().id,
      print: print.id,
      printName: print.name,
      author: author || "",
      colors,
      snapshot: this.snapshot(colors),
    });
  }

  download() {
    const print = this.ctx.getPrint();
    if (!print) return;
    const name = print.id + "-design.json";
    const blob = new Blob([this.payload("", "")], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast("Saved " + name);
    return name;
  }

  applyImported(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      toast("Invalid JSON: " + err.message, true);
      return;
    }
    if (!parsed || !parsed.colors || (parsed.type !== "enclosure-design" && parsed.type !== "print-design")) {
      toast("Not a design file (missing type/colors)", true);
      return;
    }
    const print = this.ctx.getPrint();
    const forId = parsed.print || parsed.enclosure;
    if (forId && print && forId !== print.id) {
      toast("This design is for '" + (parsed.printName || parsed.enclosureName || forId) + "' — switch print first.", true);
      return;
    }

    const report = this.classifyOrder(parsed);
    if (!report.rows.length) {
      toast("No matching pieces found", true);
      return;
    }
    this.ctx.onOrderImported(report);
  }

  // Compares every ordered color against the snapshot the order carries, not
  // against the catalog as it stands. An id that still exists is not assumed to
  // still *mean* the same thing — a re-mixed color is a real difference, and on
  // a printed order it matters.
  classifyOrder(parsed) {
    const palette = this.ctx.getPalette();
    const snapshot = parsed.snapshot || {};
    const rows = [];

    Object.entries(parsed.colors).forEach(([pieceId, value]) => {
      if (typeof value !== "string") return;
      const target = this.ctx.getTarget(pieceId);
      if (!target) return;

      // v1 files store hex and have no snapshot; v2 store ids and do.
      const asHex = HEX_RE.test(value);
      const snap = !asHex ? snapshot[value] : { name: value, hex: value.toLowerCase(), opacity: 1 };
      const current = !asHex ? palette.byId(value) : null;

      let ordered;
      if (snap) {
        ordered = { name: snap.name || value, hex: String(snap.hex || "").toLowerCase(),
                    opacity: typeof snap.opacity === "number" ? snap.opacity : 1 };
      } else if (current) {
        // no snapshot to go on — the catalog entry is the best we have
        ordered = { name: current.name, hex: current.hex, opacity: current.opacity };
      } else {
        ordered = null;
      }

      const drifted =
        !!(current && ordered) &&
        (current.hex !== ordered.hex || current.opacity !== ordered.opacity);
      const offered = !!current && target.offered.includes(value);

      let kind = "exact";
      if (!current) kind = "retired";
      else if (drifted) kind = "changed";
      else if (!offered) kind = "unoffered";

      rows.push({
        pieceId,
        label: target.label,
        requested: value,
        ordered,
        current: current ? { id: current.id, name: current.name, hex: current.hex, opacity: current.opacity } : null,
        offered: target.offered,
        kind,
        // what a visitor would be switched to, if a switch is needed
        replacement:
          ordered && target.offered.length
            ? palette.nearestId(ordered.hex, target.offered)
            : target.offered[0] || null,
      });
    });

    return { orderId: parsed.orderId || "", rows };
  }

  // ---- nostr submit dialog ----

  openDialog() {
    if (!this.ctx.getPrint()) return;
    const els = this.els;
    this.onetimeSk = null;
    els.submitStatus.classList.add("hidden");
    els.submitStatus.textContent = "";
    const extOption = els.identityMode.querySelector('option[value="extension"]');
    if (extOption) extOption.disabled = !hasExtension();
    els.identityMode.value = hasExtension() ? "extension" : "nsec";
    els.orderId.value = "";
    els.nsecInput.value = savedNsec();
    els.nsecRemember.checked = !!savedNsec();
    els.btnSubmitSend.disabled = false;
    this.onIdentityModeChange();
    els.submitDialog.showModal();
    els.orderId.focus();
  }

  async onIdentityModeChange() {
    const els = this.els;
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
      if (!this.onetimeSk) this.onetimeSk = NT.generateSecretKey();
      els.onetimePubkey.textContent = "Your npub: " + npubOf(NT.getPublicKey(this.onetimeSk));
    }
    this.updatePreview();
  }

  updatePreview() {
    this.els.submitPreview.value = this.payload(this.els.orderId.value.trim(), "");
  }

  status(msg, isError) {
    const el = this.els.submitStatus;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
    el.classList.toggle("ok", !isError);
    el.classList.remove("hidden");
  }

  async send() {
    const els = this.els;
    const orderId = els.orderId.value.trim();
    if (!orderId) {
      this.status("Enter " + (this.submitConfig().orderIdLabel || "an Order ID") + " first.", true);
      els.orderId.focus();
      return;
    }
    const mode = els.identityMode.value;
    const nsec = els.nsecInput.value.trim();
    let identity;
    try {
      identity = await resolveIdentity(mode, this.onetimeSk, nsec);
    } catch (err) {
      this.status(err.message, true);
      return;
    }

    if (mode === "nsec") {
      if (els.nsecRemember.checked && nsec) saveNsec(nsec);
      els.nsecInput.value = "";
    }

    els.btnSubmitSend.disabled = true;
    this.status("Sending…");

    const print = this.ctx.getPrint();
    const config = this.submitConfig();
    const content = this.payload(orderId, identity.pubkey);
    const recipient = await getRecipient(config);

    try {
      const res = await sendDesign({
        recipient,
        identity,
        content,
        subject: print.name + " design — " + (config.orderIdLabel || "order") + " " + orderId,
        onStatus: (m) => this.status(m),
      });
      if (res.ok > 0) {
        this.status("Sent to " + res.ok + "/" + res.relays + " relays.\nEvent: " + res.wrapId);
      } else {
        this.status("Could not publish to any of " + res.relays + " relays.\nEvent: " + res.wrapId, true);
      }
    } catch (err) {
      this.status("Failed to send: " + err.message, true);
    } finally {
      els.btnSubmitSend.disabled = false;
    }
  }
}
