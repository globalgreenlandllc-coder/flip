// Fetches a listing page on behalf of the flip web app, from the user's own
// browser session. Portals block server reads; they serve the browser.
const ALLOWED = /(^|\.)(zillow|redfin|realtor|trulia)\.com$/i;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "flip:fetch") return false;
  (async () => {
    try {
      const u = new URL(msg.url);
      if (!ALLOWED.test(u.hostname)) throw new Error("Unsupported site: " + u.hostname);
      const res = await fetch(u.toString(), { credentials: "include", headers: { accept: "text/html,application/xhtml+xml" } });
      const html = await res.text();
      sendResponse({ ok: res.ok, status: res.status, html: html.slice(0, 4_000_000) });
    } catch (err) {
      sendResponse({ ok: false, status: 0, error: String(err && err.message ? err.message : err) });
    }
  })();
  return true; // keep the channel open for the async response
});
