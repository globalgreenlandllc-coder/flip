"use client";

import { useCallback, useState } from "react";
import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import { parsePastedListing, type ListingInfo } from "@/lib/listing/fetch-listing";
import { ReportView } from "@/components/report/report-view";
import { PlanView } from "@/components/report/plan-view";
import { AssessmentView, ListingCard } from "@/components/report/assessment-view";
import { VerdictBadge } from "@/components/ui/verdict";
import { SaveDealButton } from "@/components/app/save-deal-button";

interface AnalyzeResponse {
  warning?: string;
  listing: ListingInfo | null;
  photosUsed?: { uploaded: number; fromListing: number; failed: number };
  assessment: PhotoAssessment;
  plan: RenovationPlan;
  report: Report;
}

type Photo = { url: string } | { base64: string; mediaType: "image/jpeg" };

const MAX_PHOTOS = 16;
/** Uploads travel in the request body; Vercel caps bodies at 4.5 MB. Listing photos are fetched server-side and do not count. */
const MAX_UPLOADS = 12;

/** Downscale in the browser so uploads stay small and vision stays cheap. */
async function toJpeg(file: File, maxEdge = 1280): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

export function Analyzer() {
  const [listingUrl, setListingUrl] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [showLinks, setShowLinks] = useState(false);
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [askingPrice, setAskingPrice] = useState("");
  const [pasted, setPasted] = useState<{ address?: string; beds?: number; baths?: number; sqft?: number; photos: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_UPLOADS));
  }, []);

  /** Dropped or pasted image links (e.g. dragged from a listing gallery) go into the photo-links box. */
  const addUrls = useCallback((text: string) => {
    const urls = text.split(/\s+/).filter((u) => /^https?:\/\/\S+/.test(u));
    if (!urls.length) return false;
    setPhotoUrls((prev) => [...new Set([...prev.split(/\s+/).filter(Boolean), ...urls])].join("\n"));
    setShowLinks(true);
    return true;
  }, []);

  /** A whole listing page pasted from the browser: photos, price and facts. */
  const addPastedPage = useCallback((html: string, text: string) => {
    const info = parsePastedListing(html, text, listingUrl || undefined);
    if (!info.photos.length && !info.price && !info.address) return false;
    if (info.photos.length) addUrls(info.photos.join("\n"));
    if (info.price) setAskingPrice((prev) => prev || String(info.price));
    setPasted({ address: info.address, beds: info.beds, baths: info.baths, sqft: info.sqft, photos: info.photos.length });
    return true;
  }, [listingUrl, addUrls]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, j) => j !== index);
    });
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    try {
      const photos: Photo[] = photoUrls
        .split(/\s+/)
        .filter((u) => /^https?:\/\//.test(u))
        .map((url) => ({ url }));
      if (files.length) {
        setStatus(`Preparing ${files.length} photo${files.length === 1 ? "" : "s"}…`);
        for (const { file } of files.slice(0, MAX_UPLOADS)) photos.push(await toJpeg(file));
      }
      if (!listingUrl && photos.length === 0) throw new Error("Paste a listing link, add photos, or paste photo links.");
      setStatus(photos.length ? `Looking at ${photos.length} photo${photos.length === 1 ? "" : "s"} and running the numbers…` : "Reading the listing…");
      const res = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingUrl: listingUrl || undefined,
          photos: photos.length ? photos.slice(0, MAX_PHOTOS) : undefined,
          subject: pasted && (pasted.sqft || pasted.beds || pasted.baths)
            ? { ...(pasted.sqft ? { sqft: pasted.sqft } : {}), ...(pasted.beds ? { beds: pasted.beds } : {}), ...(pasted.baths ? { baths: pasted.baths } : {}) }
            : undefined,
          deal: askingPrice ? { askingPrice: Number(askingPrice.replace(/[^0-9.]/g, "")) } : undefined,
        }),
      });
      const text = await res.text();
      let json: (AnalyzeResponse & { error?: string }) | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      if (!res.ok || !json) {
        if (res.status === 413) throw new Error("The photos are too large for one request. Use fewer or smaller photos.");
        throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      }
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus(null);
    }
  }

  return (
    <div className="space-y-8">
      <form
        onSubmit={run}
        onPaste={(e) => {
          const items = Array.from(e.clipboardData.files);
          if (items.length) { e.preventDefault(); addFiles(items); return; }
          const html = e.clipboardData.getData("text/html");
          const text = e.clipboardData.getData("text/plain");
          // A copied listing page: has image tags. Handle it wherever it lands.
          if (html && /<img\b/i.test(html)) { e.preventDefault(); addPastedPage(html, text); return; }
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== "INPUT" && tag !== "TEXTAREA" && addUrls(text)) e.preventDefault();
        }}
        className="card p-5 sm:p-6"
      >
        <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
          <div className="space-y-5">
            <div>
              <label className="label" htmlFor="listing">Listing link</label>
              <input
                id="listing"
                className="input"
                placeholder="https://www.zillow.com/homedetails/…"
                value={listingUrl}
                onChange={(e) => setListingUrl(e.target.value)}
              />
              <p className="mt-1.5 text-xs text-ink-500">
                Zillow and Redfin usually block server reads. The reliable way: on the listing page press <kbd className="rounded border border-ink-300 bg-white px-1 font-mono text-[11px]">⌘A</kbd> then <kbd className="rounded border border-ink-300 bg-white px-1 font-mono text-[11px]">⌘C</kbd>, come back and paste anywhere in this form. The photos, price, beds, baths and square feet come along.
              </p>
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="label mb-0">Photos <span className="font-normal text-ink-500">(up to {MAX_PHOTOS} per analysis)</span></span>
                <button type="button" onClick={() => setShowLinks((v) => !v)} className="text-xs font-medium text-ink-500 hover:text-ink-900">
                  {showLinks ? "Hide photo links" : "Paste photo links instead"}
                </button>
              </div>
              <label
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
                  else addUrls(e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain"));
                }}
                className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-ink-950 bg-ink-100/60" : "border-ink-300 hover:border-ink-500"}`}
              >
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
                <svg className="mb-2 h-6 w-6 text-ink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 16 5-5 4 4 3-3 6 6" /><circle cx="16" cy="9" r="1.5" />
                </svg>
                <span className="text-sm font-medium">Drop listing photos here, or click to choose</span>
                <span className="mt-1 text-xs text-ink-500">Drag them straight out of the Zillow or Redfin gallery, paste a screenshot, or upload files. Up to {MAX_UPLOADS} uploads; they are resized first.</span>
              </label>
              {files.length > 0 && (
                <ul className="mt-3 grid grid-cols-4 gap-2 sm:grid-cols-6">
                  {files.map(({ url }, i) => (
                    <li key={url} className="group relative aspect-[4/3] overflow-hidden rounded-lg border border-ink-200 bg-ink-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        aria-label="Remove photo"
                        onClick={() => removeFile(i)}
                        className="absolute right-1 top-1 rounded-full bg-ink-950/80 px-1.5 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        ×
                      </button>
                      <span className="absolute bottom-1 left-1 rounded bg-ink-950/70 px-1 text-[10px] text-white">{i + 1}</span>
                    </li>
                  ))}
                </ul>
              )}
              {showLinks && (
                <textarea
                  className="input mt-3 font-mono text-xs"
                  rows={3}
                  placeholder="One photo link per line"
                  value={photoUrls}
                  onChange={(e) => setPhotoUrls(e.target.value)}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:border-l lg:border-ink-100 lg:pl-5">
            {pasted && (
              <p className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-700">
                Read from your paste: {pasted.photos} photo{pasted.photos === 1 ? "" : "s"}
                {pasted.address ? ` · ${pasted.address}` : ""}
                {pasted.beds ? ` · ${pasted.beds} bd` : ""}
                {pasted.baths ? ` · ${pasted.baths} ba` : ""}
                {pasted.sqft ? ` · ${pasted.sqft.toLocaleString()} sqft` : ""}
              </p>
            )}
            <div>
              <label className="label" htmlFor="asking">Asking price</label>
              <input id="asking" className="input" placeholder="from listing if readable" inputMode="numeric" value={askingPrice} onChange={(e) => setAskingPrice(e.target.value)} />
            </div>
            <button type="submit" disabled={!!status} className="btn-primary mt-auto w-full">
              {status ? (
                <>
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  {status}
                </>
              ) : (
                "Analyze this house"
              )}
            </button>
          </div>
        </div>
      </form>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {result && (
        <section className="space-y-8">
          {result.warning && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{result.warning}</p>}

          <div className="card flex flex-wrap items-center gap-4 p-5">
            <VerdictBadge verdict={result.report.deal.verdict} size="lg" />
            <p className="flex-1 basis-80 text-lg leading-snug">{result.report.deal.decidingFactor}</p>
            <SaveDealButton payload={{ report: result.report, plan: result.plan, assessment: result.assessment, listing: result.listing }} />
          </div>

          {result.listing && <ListingCard listing={result.listing} />}
          {result.photosUsed && (
            <p className="text-sm text-ink-500">
              Looked at {result.photosUsed.uploaded + result.photosUsed.fromListing} photos
              {result.photosUsed.uploaded ? ` · ${result.photosUsed.uploaded} uploaded` : ""}
              {result.photosUsed.fromListing ? ` · ${result.photosUsed.fromListing} from the listing` : ""}
              {result.photosUsed.failed ? ` · ${result.photosUsed.failed} could not be fetched` : ""}.
            </p>
          )}
          <AssessmentView assessment={result.assessment} />
          <PlanView plan={result.plan} />
          <ReportView report={result.report} hideVerdict />
        </section>
      )}
    </div>
  );
}
