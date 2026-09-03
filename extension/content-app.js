// Bridge between the flip web app (window.postMessage) and the extension.
// The app says hello; we answer ready. The app asks for a listing page; we
// fetch it in the background and post the HTML back.
window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || typeof event.data.type !== "string") return;
  const { type } = event.data;
  if (type === "flip:hello") {
    window.postMessage({ type: "flip:ready", version: chrome.runtime.getManifest().version }, "*");
    return;
  }
  if (type === "flip:fetch" && typeof event.data.url === "string") {
    const id = event.data.id;
    chrome.runtime.sendMessage({ type: "flip:fetch", url: event.data.url }, (res) => {
      const err = chrome.runtime.lastError;
      window.postMessage({ type: "flip:fetch:result", id, ...(err ? { ok: false, status: 0, error: err.message } : res) }, "*");
    });
  }
});
