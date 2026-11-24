import { safeFetch } from "@/lib/net/safe-fetch";
import { sniffImage } from "./image-type";
import type { PhotoInput } from "./analyze-photos";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const MAX_BYTES = 4_500_000;

/**
 * Fetch a listing photo ourselves and hand Claude the bytes. Listing CDNs
 * sometimes refuse non-browser fetches, and one bad URL must not sink the
 * whole analysis; failures come back as null and are skipped.
 *
 * The link is whatever a person pasted, so it goes through safeFetch (public
 * internet only, size cap, deadline), and the file must really be an image:
 * its first bytes decide the type, not the server's Content-Type.
 */
export async function fetchPhoto(url: string, timeoutMs = 10_000): Promise<PhotoInput | null> {
  try {
    const res = await safeFetch(url, { headers: { "user-agent": UA, accept: "image/*,*/*;q=0.8" }, timeoutMs, maxBytes: MAX_BYTES });
    if (!res.ok || res.body.byteLength === 0) return null;
    const mediaType = sniffImage(res.body.subarray(0, 16));
    if (!mediaType) return null;
    return { base64: res.body.toString("base64"), mediaType };
  } catch {
    return null;
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
