import type { PhotoInput, PhotoMediaType } from "./analyze-photos";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_BYTES = 4_500_000;
const MEDIA: Record<string, PhotoMediaType> = { "image/jpeg": "image/jpeg", "image/jpg": "image/jpeg", "image/png": "image/png", "image/webp": "image/webp", "image/gif": "image/gif" };

/**
 * Fetch a listing photo ourselves and hand Claude the bytes. Listing CDNs
 * sometimes refuse non-browser fetches, and one bad URL must not sink the
 * whole analysis; failures come back as null and are skipped.
 */
export async function fetchPhoto(url: string, timeoutMs = 10_000): Promise<PhotoInput | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, signal: controller.signal, redirect: "follow" });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const mediaType = MEDIA[type];
    if (!mediaType) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null;
    return { base64: buf.toString("base64"), mediaType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch many, keep order, drop failures. */
export async function fetchPhotos(urls: string[]): Promise<{ photos: PhotoInput[]; failed: string[] }> {
  const results = await Promise.all(urls.map((u) => fetchPhoto(u)));
  const photos: PhotoInput[] = [];
  const failed: string[] = [];
  results.forEach((r, i) => (r ? photos.push(r) : failed.push(urls[i])));
  return { photos, failed };
}
