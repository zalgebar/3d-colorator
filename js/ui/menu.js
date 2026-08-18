// Popup menus that escape their scroll container.
//
// An absolutely-positioned menu is clipped by any ancestor that scrolls — the
// sidebar, and the offered-colors list inside the piece dialog. A fixed-position
// element is laid out against the viewport instead, so ancestor `overflow` never
// clips it. It still has to be parented to the open <dialog> when there is one:
// a modal dialog makes the rest of the document inert, so a menu appended to
// <body> would render but refuse clicks.

const GAP = 4;
const EDGE = 8;

export function closeMenus() {
  document.querySelectorAll(".menu").forEach((m) => m.remove());
}

function place(menu, anchor) {
  const a = anchor.getBoundingClientRect();
  menu.style.minWidth = Math.max(a.width, 168) + "px";
  const m = menu.getBoundingClientRect();

  let top = a.bottom + GAP;
  // flip above the anchor when there is no room below
  if (top + m.height > window.innerHeight - EDGE) {
    const above = a.top - m.height - GAP;
    top = above >= EDGE ? above : Math.max(EDGE, window.innerHeight - m.height - EDGE);
  }
  const left = Math.min(Math.max(EDGE, a.left), window.innerWidth - m.width - EDGE);

  menu.style.top = Math.round(top) + "px";
  menu.style.left = Math.round(left) + "px";
}

// build(menu) fills the menu; returns the element so callers can inspect it.
export function openFloatingMenu(anchor, build) {
  closeMenus();
  const menu = document.createElement("div");
  menu.className = "menu floating";
  build(menu);

  const host = anchor.closest("dialog") || document.body;
  host.appendChild(menu);
  place(menu, anchor);

  const dismiss = (e) => {
    // scrolling or clicking *within* the menu is use, not dismissal
    if (e && e.target instanceof Node && menu.contains(e.target)) return;
    closeMenus();
    window.removeEventListener("scroll", dismiss, true);
    window.removeEventListener("resize", dismiss);
    document.removeEventListener("pointerdown", dismiss, true);
    document.removeEventListener("keydown", onKey, true);
  };
  const onKey = (e) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // don't also close the dialog underneath
      dismiss();
    }
  };
  setTimeout(() => {
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    document.addEventListener("pointerdown", dismiss, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);

  return menu;
}
