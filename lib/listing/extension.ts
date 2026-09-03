/**
 * Browser-side bridge to the flip Chrome extension (extension/content-app.js).
 * The extension fetches listing pages from the user's own browser session,
 * which portals allow while they block server reads.
 */

export interface ExtensionFetchResult {
  ok: boolean;
  status: number;
  html?: string;
  error?: string;
}

function once<T>(match: (data: Record<string, unknown>) => T | undefined, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || !event.data || typeof event.data !== "object") return;
      const hit = match(event.data as Record<string, unknown>);
      if (hit !== undefined) {
        cleanup();
        resolve(hit);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
    };
    window.addEventListener("message", onMessage);
  });
}

/** Resolves the extension version, or null when it is not installed. */
export async function detectExtension(timeoutMs = 500): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const reply = once((d) => (d.type === "flip:ready" ? String(d.version ?? "?") : undefined), timeoutMs);
  window.postMessage({ type: "flip:hello" }, "*");
  return reply;
}

/** Ask the extension for a listing page. Null when it does not answer in time. */
export async function fetchViaExtension(url: string, timeoutMs = 25_000): Promise<ExtensionFetchResult | null> {
  if (typeof window === "undefined") return null;
  const id = Math.random().toString(36).slice(2);
  const reply = once<ExtensionFetchResult>(
    (d) => (d.type === "flip:fetch:result" && d.id === id ? { ok: Boolean(d.ok), status: Number(d.status ?? 0), html: typeof d.html === "string" ? d.html : undefined, error: typeof d.error === "string" ? d.error : undefined } : undefined),
    timeoutMs,
  );
  window.postMessage({ type: "flip:fetch", id, url }, "*");
  return reply;
}
