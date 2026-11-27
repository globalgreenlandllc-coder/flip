/**
 * Where to go after signing in or up, as Clerk was told in `redirect_url` (it sends a signed-out visitor of /app/... to
 * the sign-in page with the page they asked for there). The sign-in and sign-up pages hand it on to each other, so a
 * visitor who switches from one to the other still lands where they were going, with the link they pasted.
 *
 * Only a place on this site is handed on: a path ("/app/analyze?link=..."), or a full address on this same host,
 * turned into its path. Anything else (another site, "//other.site", "javascript:") is dropped.
 */
export function returnTo(raw: unknown, host: string | null): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2_000) return null;
  const base = "http://this.site";
  let url: URL;
  try {
    url = raw.startsWith("/") ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (raw.startsWith("/")) {
    // "//other.site/x" and "/\\other.site" are other sites to a browser.
    if (raw.startsWith("//") || raw.startsWith("/\\") || url.origin !== base) return null;
  } else {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!host || url.host.toLowerCase() !== host.toLowerCase()) return null;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The other sign page's address, carrying the place to return to when there is one. */
export function withReturn(page: "/sign-in" | "/sign-up", to: string | null): string {
  return to ? `${page}?redirect_url=${encodeURIComponent(to)}` : page;
}
