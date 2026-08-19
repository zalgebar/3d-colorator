// Painting a color chip. Translucent colors are drawn over a checkerboard so
// "45% smoke" is distinguishable from "dark grey" at a glance, in every surface
// that shows a swatch.

const CHECK = "#3a4048";
const CHECKER = [
  "linear-gradient(45deg," + CHECK + " 25%,transparent 25%)",
  "linear-gradient(-45deg," + CHECK + " 25%,transparent 25%)",
  "linear-gradient(45deg,transparent 75%," + CHECK + " 75%)",
  "linear-gradient(-45deg,transparent 75%," + CHECK + " 75%)",
].join(",");

export function rgba(hex, opacity = 1) {
  const h = String(hex || "#cccccc").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return "rgba(" + r + "," + g + "," + b + "," + opacity + ")";
}

// The color rides as the topmost background layer; at opacity 1 it hides the
// checker entirely, so opaque and translucent chips share one code path.
export function paintSwatch(el, color) {
  const fill = rgba(color.hex, color.opacity);
  el.style.backgroundImage = "linear-gradient(" + fill + "," + fill + ")," + CHECKER;
  el.style.backgroundSize = "100% 100%,8px 8px,8px 8px,8px 8px,8px 8px";
  el.style.backgroundPosition = "0 0,0 0,0 4px,4px -4px,-4px 0";
}

export function swatchTitle(color) {
  const pct = Math.round(color.opacity * 100);
  return color.opacity < 1 ? color.name + " · " + pct + "%" : color.name;
}
