// Drag-to-resize sidebar. Width is a CSS custom property so the layout and the
// viewport's ResizeObserver pick it up without any explicit relayout call.

const KEY = "colorator.sidebarWidth";
const MIN = 260;
const DEFAULT = 320;

function maxWidth() {
  return Math.max(MIN, Math.round(window.innerWidth * 0.6));
}

function apply(px) {
  const w = Math.min(maxWidth(), Math.max(MIN, Math.round(px)));
  document.documentElement.style.setProperty("--sidebar-w", w + "px");
  return w;
}

export function initSidebarResizer(handle, sidebar) {
  let saved = parseInt(localStorage.getItem(KEY) || "", 10);
  if (!isNaN(saved)) apply(saved);

  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.getBoundingClientRect().width;
    handle.classList.add("dragging");
    document.body.classList.add("resizing");

    const move = (ev) => apply(startW + (ev.clientX - startX));
    const up = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      handle.classList.remove("dragging");
      document.body.classList.remove("resizing");
      try {
        localStorage.setItem(KEY, String(Math.round(sidebar.getBoundingClientRect().width)));
      } catch {
        /* private browsing — the width just won't persist */
      }
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
  });

  handle.addEventListener("dblclick", () => {
    apply(DEFAULT);
    try {
      localStorage.setItem(KEY, String(DEFAULT));
    } catch {}
  });

  // a narrower window must not leave the sidebar wider than the screen
  window.addEventListener("resize", () => apply(sidebar.getBoundingClientRect().width));
}
