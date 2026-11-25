"use client";

import { useCallback, useEffect, useState } from "react";
import type { Report } from "@/lib/engine/types";
import type { RenovationPlan } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import { parseFetchedListing, parsePastedListing, type ListingInfo } from "@/lib/listing/fetch-listing";
import { detectExtension, fetchViaExtension } from "@/lib/listing/extension";
import Link from "next/link";
import type { Prefill } from "@/lib/listing/prefill";
import { analysisStarted, browserRead, formFromPrefill, houseLearned, linkGiven, linkPasted, listingToSend, pagePasted, photoLinksAdded, type HouseForm } from "@/lib/listing/form";
import { webLink } from "@/lib/listing/house";
import { ReportView } from "@/components/report/report-view";
import { PlanView } from "@/components/report/plan-view";
import { AssessmentView, ListingCard } from "@/components/report/assessment-view";
import { VerdictBadge } from "@/components/ui/verdict";
import { DemoBanner } from "@/components/ui/demo";
import { SaveDealButton } from "@/components/app/save-deal-button";
import type { UsageSummary } from "@/lib/usage/limits";
import type { SubjectSources } from "@/lib/listing/subject";

interface AnalyzeResponse {
  /** Where the market data came from; `demo` is true while it is made up. */
  provider?: string;
  demo?: boolean;
  /** Where each fact about the house came from: the listing, or the provider's record. */
  subjectSources?: SubjectSources;
  warning?: string;
  /** This person's month after the run. */
  usage?: UsageSummary;
  listing: ListingInfo | null;
  photosUsed?: { uploaded: number; fromListing: number; failed: number; leftOut?: number };
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

export function Analyzer({ prefill, initialUsage }: { prefill?: Prefill | null; initialUsage?: UsageSummary | null }) {
  const [usage, setUsage] = useState<UsageSummary | null>(initialUsage ?? null);
  // The link, the photo links, the price and the listing as this browser read it (a pasted
  // page, the button on the listing page, the extension), held as one value because they are
  // about one house: lib/listing/form.ts keeps them that way when the person moves to another.
  const [house, setHouse] = useState<HouseForm>(() => formFromPrefill(prefill));
  const [showLinks, setShowLinks] = useState(Boolean(prefill?.photos.length));
  const [files, setFiles] = useState<{ file: File; url: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ListingInfo | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [extension, setExtension] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    detectExtension().then((v) => { if (alive) setExtension(v); });
    return () => { alive = false; };
  }, []);

  const addFiles = useCallback((list: FileList | File[] | null) => {
    if (!list) return;
    const incoming = Array.from(list)
      .filter((f) => f.type.startsWith("image/"))
      .map((file) => ({ file, url: URL.createObjectURL(file) }));
    setFiles((prev) => [...prev, ...incoming].slice(0, MAX_UPLOADS));
  }, []);

  /** Dropped or pasted image links (e.g. dragged from a listing gallery) go into the photo-links box. */
  const addUrls = useCallback((text: string) => {
    if (!text.split(/\s+/).some((u) => /^https?:\/\/\S+$/.test(u))) return false;
    setHouse((now) => photoLinksAdded(now, text) ?? now);
    setShowLinks(true);
    return true;
  }, []);

  /** A whole listing page pasted from the browser: photos, price, facts, description. */
  const addPastedPage = useCallback((html: string, text: string) => {
    const next = pagePasted(house, parsePastedListing(html, text, webLink(house.link) || undefined), new Date(), files.length);
    if (!next) return false;
    setHouse(next);
    if (next.photoLinks) setShowLinks(true);
    return true;
  }, [house, files.length]);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, j) => j !== index);
    });
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    // Is what the form holds about this link's house? A reading of another listing is set aside
    // here, with the photo links it filled in and the price, before anything is sent.
    await analyze(linkGiven(house, house.link, files.length));
  }

  /** The analysis itself, for a form already settled on its link (linkGiven); passed in so a pasted link can start it before state settles. */
  async function analyze(settled: HouseForm) {
    setError(null);
    setBlocked(null);
    setResult(null);
    let form = analysisStarted(settled);
    setHouse(form);
    const listingUrl = form.link;
    try {
      const photos: Photo[] = form.photoLinks
        .split(/\s+/)
        .filter((u) => /^https?:\/\//.test(u))
        .map((url) => ({ url }));
      // Link only, extension installed: read the page through the browser.
      if (webLink(listingUrl) && photos.length === 0 && files.length === 0 && extension) {
        setStatus("Reading the listing through your browser…");
        const r = await fetchViaExtension(listingUrl);
        const fetched = r?.ok && r.html ? { ...parseFetchedListing(listingUrl, r.html), read: { at: new Date().toISOString(), via: "browser" as const } } : null;
        // A check page shown to the browser is not the listing. The server tries next, and says so if it is turned away too.
        if (fetched?.fetched) {
          form = browserRead(form, fetched);
          setHouse((now) => (now.link.trim() === listingUrl ? browserRead(now, fetched) : now));
          for (const url of fetched.photos) photos.push({ url });
          if (fetched.photos.length) setShowLinks(true);
        }
      }
      if (files.length) {
        setStatus(`Preparing ${files.length} photo${files.length === 1 ? "" : "s"}…`);
        for (const { file } of files.slice(0, MAX_UPLOADS)) photos.push(await toJpeg(file));
      }
      if (!listingUrl && photos.length === 0) throw new Error("Paste a listing link, add photos, or paste photo links.");
      setStatus(photos.length ? `Looking at ${photos.length} photo${photos.length === 1 ? "" : "s"} and running the numbers…` : "Reading the listing…");
      const listing = listingToSend(form);
      const askingPrice = form.price ? Number(form.price.replace(/[^0-9.]/g, "")) : listing?.price;
      const res = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingUrl: listingUrl || undefined,
          listing,
          photos: photos.length ? photos.slice(0, MAX_PHOTOS) : undefined,
          deal: askingPrice ? { askingPrice } : undefined,
        }),
      });
      const text = await res.text();
      let json: (AnalyzeResponse & { error?: string; blocked?: boolean }) | null = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
      // A finished run and a turned-away one (429) both say where the month stands.
      if (json?.usage) setUsage(json.usage);
      // What the answer says this link's house is: a page pasted under the link later is told from it.
      const answered = json?.listing?.address;
      if (answered) setHouse((now) => (now.link.trim() === listingUrl ? houseLearned(now, listingUrl, answered) : now));
      if (!res.ok || !json) {
        if (res.status === 413) throw new Error("The photos are too large for one request. Use fewer or smaller photos.");
        // The site turned the server away and there is nothing to look at: show the other ways in.
        // Any other refusal (no asking price, say) is said in its own words, link read or not.
        if (res.status === 400 && json?.listing && json.blocked === true) {
          setBlocked(json.listing);
          return;
        }
        throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
      }
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus(null);
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.files);
    if (items.length) { e.preventDefault(); addFiles(items); return; }
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    const tag = (e.target as HTMLElement).tagName;
    const singleLink = /^\s*https?:\/\/\S+\s*$/.test(text);
    // A link pasted into the listing field starts the analysis by itself.
    if (tag === "INPUT" && (e.target as HTMLInputElement).id === "listing" && singleLink) {
      e.preventDefault();
      // It starts by itself only when everything in the form is this link's. Photos or a price
      // the person put in themselves may be another house's: then the form waits, and says why.
      const pasted = linkPasted(house, text.trim(), files.length);
      if (pasted.start) void analyze(pasted.form);
      else setHouse(pasted.form);
      return;
    }
    // A link pasted into another field is just a link. Anything bigger is a copied listing page.
    if ((tag === "INPUT" || tag === "TEXTAREA") && singleLink) return;
    if ((html && /<img\b/i.test(html)) || text.length > 80) {
      if (addPastedPage(html, text)) { e.preventDefault(); setBlocked(null); return; }
    }
    if (tag !== "INPUT" && tag !== "TEXTAREA" && addUrls(text)) e.preventDefault();
  }

  // A result that does not say it is real is treated as a demo.
  const demo = result ? result.demo !== false : false;
  // What the box beside the form says about the listing as this browser read it.
  const read = house.read;
  const readPhotos = house.filled.photos.length;
  const readHow = read?.read?.via === "button" ? "From the listing page" : read?.read?.via === "browser" ? "Read through your browser" : "Read from your paste";

  return (
    <div className="space-y-8">
      <form onSubmit={run} onPaste={handlePaste} className="card p-5 sm:p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_220px]">
          <div className="space-y-5">
            <div>
              <label className="label" htmlFor="listing">Listing link</label>
              <input
                id="listing"
                className="input"
                placeholder="https://www.zillow.com/homedetails/…"
                value={house.link}
                onChange={(e) => { const link = e.target.value; setHouse((now) => ({ ...now, link })); }}
              />
              <p className="mt-1.5 text-xs text-ink-500">
                Paste a link from Zillow, Redfin, Realtor, Movoto, Estately or a brokerage site and the analysis starts by itself.
                {extension ? " Chrome extension detected: pages are read through your browser." : ""}
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
                  value={house.photoLinks}
                  onChange={(e) => { const photoLinks = e.target.value; setHouse((now) => ({ ...now, photoLinks })); }}
                />
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:border-l lg:border-ink-100 lg:pl-5">
            {house.notice && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-form-notice>
                {house.notice}
              </p>
            )}
            {read && (
              <p className={`rounded-lg border p-3 text-xs ${readPhotos ? "border-brand-200 bg-brand-50 text-brand-700" : "border-amber-200 bg-amber-50 text-amber-800"}`} data-form-read>
                {readHow}: {readPhotos} photo{readPhotos === 1 ? "" : "s"}
                {read.address ? ` · ${read.address}` : ""}
                {read.beds ? ` · ${read.beds} bd` : ""}
                {read.baths ? ` · ${read.baths} ba` : ""}
                {read.sqft ? ` · ${read.sqft.toLocaleString()} sqft` : ""}
                {read.description && read.description.source !== "meta" ? " · description kept" : " · no description came through"}
                {read.details?.length ? ` · ${read.details.length} detail line${read.details.length === 1 ? "" : "s"}` : ""}
                {readPhotos ? "" : ". No photos came through: drag them from the gallery into the drop zone, or use the flip it bookmark."}
              </p>
            )}
            <div>
              <label className="label" htmlFor="asking">Asking price</label>
              <input id="asking" className="input" placeholder="from listing if readable" inputMode="numeric" value={house.price} onChange={(e) => { const price = e.target.value; setHouse((now) => ({ ...now, price })); }} />
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
            {usage && (
              <p data-usage className={`-mt-2 text-center text-xs ${usage.used >= usage.limit ? "font-medium text-pass" : "text-ink-500"}`}>
                {usage.used} of {usage.limit} analyses used this month
              </p>
            )}
          </div>
        </div>
      </form>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {blocked && (
        <section className="card border-amber-200 p-5 sm:p-6">
          <h2 className="text-lg font-semibold">{blocked.host} would not let the server read this page</h2>
          {blocked.address && <p className="mt-1 text-sm text-ink-700">{blocked.address}</p>}
          <p className="mt-3 text-sm text-ink-700">Three ways in, fastest first:</p>
          <ol className="mt-3 space-y-3">
            <li className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">1</span>
              <div>
                <span className="font-medium">Install the Chrome extension once</span>, then press Analyze again. It reads the page through your browser.{" "}
                <Link href="/app/extension" className="btn-secondary ml-1 px-2.5 py-1 text-xs">Get the extension</Link>
              </div>
            </li>
            <li className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">2</span>
              <div>
                <span className="font-medium">Copy the page.</span>{" "}
                <a href={blocked.url} target="_blank" rel="noreferrer" className="underline">Open the listing</a>, press <kbd className="rounded border border-ink-300 bg-white px-1 font-mono text-[11px]">⌘A</kbd> then <kbd className="rounded border border-ink-300 bg-white px-1 font-mono text-[11px]">⌘C</kbd>, then click the box below and press <kbd className="rounded border border-ink-300 bg-white px-1 font-mono text-[11px]">⌘V</kbd>.
                <div
                  tabIndex={0}
                  onPaste={handlePaste}
                  className="mt-2 flex h-16 cursor-text items-center justify-center rounded-lg border-2 border-dashed border-ink-300 text-sm text-ink-500 focus:border-ink-950 focus:outline-none"
                >
                  Click here, then paste the copied page
                </div>
              </div>
            </li>
            <li className="flex gap-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">3</span>
              <div><span className="font-medium">Drag the gallery photos</span> into the drop zone above and enter the asking price.</div>
            </li>
          </ol>
        </section>
      )}

      {result && (
        <section className="space-y-8">
          {demo && <DemoBanner />}

          <div className="card flex flex-wrap items-center gap-4 p-5">
            <VerdictBadge verdict={result.report.deal.verdict} size="lg" demo={demo} />
            <p className="flex-1 basis-80 text-lg leading-snug">{result.report.deal.decidingFactor}</p>
            <SaveDealButton payload={{ report: result.report, plan: result.plan, assessment: result.assessment, listing: result.listing, provider: result.provider, subjectSources: result.subjectSources }} />
          </div>

          {result.listing && <ListingCard listing={result.listing} />}
          {result.photosUsed && (
            <p className="text-sm text-ink-500">
              Looked at {result.photosUsed.uploaded + result.photosUsed.fromListing} photos
              {result.photosUsed.uploaded ? ` · ${result.photosUsed.uploaded} uploaded` : ""}
              {result.photosUsed.fromListing ? ` · ${result.photosUsed.fromListing} from the listing` : ""}
              {result.photosUsed.failed ? ` · ${result.photosUsed.failed} could not be fetched` : ""}
              {result.photosUsed.leftOut ? ` · ${result.photosUsed.leftOut} left out to stay under the size the photo reading takes` : ""}.
            </p>
          )}
          <AssessmentView assessment={result.assessment} />
          <PlanView plan={result.plan} demo={demo} />
          <ReportView report={result.report} hideVerdict demo={demo} sources={result.subjectSources} conditionFrom="photos" />
        </section>
      )}
    </div>
  );
}
