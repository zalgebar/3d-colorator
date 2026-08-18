// Shared transient UI: the toast strip and the loading overlay.

let toastEl = null;
let loadingEl = null;
let timer = null;

export function initFeedback({ toast, loading }) {
  toastEl = toast;
  loadingEl = loading;
}

export function toast(msg, isError) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.toggle("error", !!isError);
  toastEl.classList.remove("hidden");
  clearTimeout(timer);
  timer = setTimeout(() => toastEl.classList.add("hidden"), 3000);
}

export function showLoading(on) {
  if (loadingEl) loadingEl.classList.toggle("hidden", !on);
}
