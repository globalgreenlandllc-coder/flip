// Reads a listing page on behalf of the flip web app, from the user's own
// browser. Portals block server reads but serve the browser.
//
// Two strategies: a plain fetch with the user's cookies, and if the portal
// answers with a block or challenge page, a background tab that loads the
// listing like a normal visit and hands back the rendered DOM.
const ALLOWED = /(^|\.)(zillow|redfin|realtor|trulia)\.com$/i;
const MAX_HTML = 4_000_000;

function looksBlocked(status, html) {
  if (status >= 400) return true;
  return /px-captcha|press\s*&\s*hold|access denied|are you a human|captcha-delivery|blocked/i.test(html) && !/<meta[^>]+og:image/i.test(html);
}

async function fetchDirect(url) {
  const res = await fetch(url, { credentials: "include", headers: { accept: "text/html,application/xhtml+xml" } });
  const html = await res.text();
  return { ok: res.ok && !looksBlocked(res.status, html), status: res.status, html };
}

function waitForLoad(tabId, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(onUpdated); resolve(false); }, timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve(true);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function fetchViaTab(url) {
  const tab = await chrome.tabs.create({ url, active: false });
  try {
    await waitForLoad(tab.id, 20_000);
    // Give lazy galleries a moment to attach their images.
    await new Promise((r) => setTimeout(r, 2500));
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => ({ html: document.documentElement.outerHTML, title: document.title }),
    });
    const html = (result && result.result && result.result.html) || "";
    return { ok: html.length > 0 && !looksBlocked(200, html), status: 200, html, via: "tab" };
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "flip:fetch") return false;
  (async () => {
    try {
      const u = new URL(msg.url);
      if (!ALLOWED.test(u.hostname)) throw new Error("Unsupported site: " + u.hostname);
      let r = await fetchDirect(u.toString());
      if (!r.ok) r = await fetchViaTab(u.toString());
      sendResponse({ ok: r.ok, status: r.status, via: r.via || "fetch", html: r.html.slice(0, MAX_HTML) });
    } catch (err) {
      sendResponse({ ok: false, status: 0, error: String(err && err.message ? err.message : err) });
    }
  })();
  return true; // keep the channel open for the async response
});
