// The viewport background, and the two ways it can end up in a screenshot.
//
// The WebGL canvas is always cleared to transparent and the background is
// painted in CSS behind it. One source of truth for what sits behind the model,
// including the checkerboard — which no clear colour can express — and it makes
// "Screenshot no BG" the canvas exactly as it already is, with nothing stripped.
//
// Translucent pieces are why this matters: whatever is behind them is part of
// their rendered colour, so the choice changes what the visitor thinks they are
// ordering. It is a viewing preference, not part of the design, so it lives in
// localStorage and never reaches the share link.

import { openFloatingMenu, closeMenus } from "./menu.js";

const KEY = "colorator.background";
export const CHECKER = "checker";
const DEFAULT = "#000000";

// One checker square, in CSS pixels; the 24px tile is 2x2 of them.
// Mirrored by .viewport-wrap.checker — keep the two in step.
const CHECK = 12;
const CHECK_LIGHT = "#ffffff";
const CHECK_DARK = "#cccccc";

export const PRESETS = [
  { value: "#000000", name: "Black" },
  { value: "#ffffff", name: "White" },
  { value: CHECKER, name: "Checkerboard" },
  { value: "#00B140", name: "Green" },
  { value: "#0047BB", name: "Blue" },
];

function isHex(v) {
  return /^#[0-9a-f]{6}$/i.test(v);
}

// localStorage is user-writable and survives across versions, so a stored
// value that is neither a preset nor a hex colour falls back rather than
// reaching CSS as a garbage background.
export function normalizeBackground(v) {
  if (v === CHECKER) return CHECKER;
  return isHex(v) ? v.toLowerCase() : DEFAULT;
}

function named(value) {
  const hit = PRESETS.find((p) => p.value.toLowerCase() === value);
  return hit ? hit.name : value.toUpperCase();
}

// A swatch that shows the checkerboard as a checkerboard rather than as a
// colour, so the menu row and the button read the same as the viewport.
function paintBgSwatch(el, value) {
  el.classList.toggle("checker", value === CHECKER);
  el.style.background = value === CHECKER ? "" : value;
}

export class Background {
  constructor(wrap, button, swatch) {
    this.wrap = wrap;
    this.button = button;
    this.swatch = swatch;
    this.value = normalizeBackground(localStorage.getItem(KEY) || DEFAULT);
    this.apply();

    button.addEventListener("click", () => this.openMenu());
  }

  set(value) {
    this.value = normalizeBackground(value);
    localStorage.setItem(KEY, this.value);
    this.apply();
  }

  // Live preview while dragging in the OS colour picker: shown, not yet stored.
  preview(value) {
    this.value = normalizeBackground(value);
    this.apply();
  }

  apply() {
    const checker = this.value === CHECKER;
    this.wrap.classList.toggle("checker", checker);
    this.wrap.style.setProperty("--viewport-bg", checker ? CHECK_LIGHT : this.value);
    paintBgSwatch(this.swatch, this.value);
    this.button.title = "Background: " + named(this.value);
  }

  // Bakes the current background into a 2D context the size of the render
  // buffer, so a composited screenshot matches what was on screen. `ratio` is
  // the renderer's pixel ratio — the checker has to scale with it or the
  // squares come out the wrong size in the file.
  paintInto(ctx, w, h, ratio) {
    if (this.value !== CHECKER) {
      ctx.fillStyle = this.value;
      ctx.fillRect(0, 0, w, h);
      return;
    }
    const s = CHECK * (ratio || 1);
    ctx.fillStyle = CHECK_LIGHT;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = CHECK_DARK;
    for (let y = 0, row = 0; y < h; y += s, row++) {
      for (let x = (row % 2) * s; x < w; x += s * 2) {
        ctx.fillRect(x, y, s, s);
      }
    }
  }

  openMenu() {
    openFloatingMenu(this.button, (menu) => {
      PRESETS.forEach((preset) => {
        menu.appendChild(this.row(preset.value, preset.name, () => {
          this.set(preset.value);
          closeMenus();
        }));
      });
      menu.appendChild(this.customRow());
    });
  }

  row(value, name, onPick) {
    const item = document.createElement("div");
    item.className = "mi";

    const sw = document.createElement("span");
    sw.className = "bg-swatch";
    paintBgSwatch(sw, value);
    item.appendChild(sw);

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = name;
    item.appendChild(nm);

    if (this.value === value.toLowerCase()) {
      const ck = document.createElement("span");
      ck.className = "ck";
      ck.textContent = "✓";
      item.appendChild(ck);
    }

    item.addEventListener("click", onPick);
    return item;
  }

  customRow() {
    const item = document.createElement("label");
    item.className = "mi";

    const input = document.createElement("input");
    input.type = "color";
    input.className = "bg-swatch as-input";
    input.value = this.value === CHECKER ? DEFAULT : this.value;
    item.appendChild(input);

    const nm = document.createElement("span");
    nm.className = "nm";
    nm.textContent = "Custom…";
    item.appendChild(nm);

    input.addEventListener("input", () => this.preview(input.value));
    input.addEventListener("change", () => this.set(input.value));
    return item;
  }
}
