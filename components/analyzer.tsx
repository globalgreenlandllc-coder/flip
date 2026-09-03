"use client";

import { useState } from "react";
import type { Report } from "@/lib/engine/types";
import type { RenovationPlan, PlanItem } from "@/lib/engine/renovation";
import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import { ReportView } from "./evaluator";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

interface AnalyzeResponse {
  warning?: string;
  listing: ListingInfo | null;
  assessment: PhotoAssessment;
  plan: RenovationPlan;
  report: Report;
}

type Photo = { url: string } | { base64: string; mediaType: "image/jpeg" };

const MAX_PHOTOS = 12;

/** Downscale in the browser so uploads stay small and vision stays cheap. */
async function toJpeg(file: File, maxEdge = 1600): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mediaType: "image/jpeg" };
}

const ACTION_STYLE: Record<PlanItem["action"], string> = {
  required: "bg-red-100 text-red-800",
  replace: "bg-emerald-100 text-emerald-800",
  refresh: "bg-emerald-50 text-emerald-700",
  inspect: "bg-amber-50 text-amber-800",
  skip: "bg-neutral-100 text-neutral-500",
};

export function Analyzer() {
  const [listingUrl, setListingUrl] = useState("");
  const [photoUrls, setPhotoUrls] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [askingPrice, setAskingPrice] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResponse | null>(null);

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
        for (const f of files.slice(0, MAX_PHOTOS - photos.length)) photos.push(await toJpeg(f));
      }
      if (!listingUrl && photos.length === 0) throw new Error("Paste a listing link, photo links, or upload photos.");
      setStatus(photos.length ? `Looking at ${photos.length} photos and running the numbers…` : "Reading the listing…");
      const res = await fetch("/api/v1/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingUrl: listingUrl || undefined,
          photos: photos.length ? photos.slice(0, MAX_PHOTOS) : undefined,
          deal: askingPrice ? { askingPrice: Number(askingPrice) } : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setStatus(null);
    }
  }

  return (
    <div>
      <form onSubmit={run} className="mt-8 grid gap-4 rounded-xl border border-neutral-200 p-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-neutral-600">Listing link</span>
          <input
            className="rounded-md border border-neutral-300 px-2 py-1.5"
            placeholder="https://www.zillow.com/homedetails/…"
            value={listingUrl}
            onChange={(e) => setListingUrl(e.target.value)}
          />
          <span className="text-xs text-neutral-500">Reads the public listing metadata. Zillow and Redfin usually block this, so upload the photos too.</span>
        </label>
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            <span className="text-neutral-600">Photos (up to {MAX_PHOTOS})</span>
            <input
              type="file"
              accept="image/*"
              multiple
              className="rounded-md border border-neutral-300 px-2 py-1.5"
              onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
            />
            <textarea
              className="mt-1 rounded-md border border-neutral-300 px-2 py-1.5 font-mono text-xs"
              rows={2}
              placeholder="…or paste photo links, one per line"
              value={photoUrls}
              onChange={(e) => setPhotoUrls(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-600">Asking price</span>
            <input
              className="rounded-md border border-neutral-300 px-2 py-1.5"
              placeholder="from listing if readable"
              inputMode="numeric"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
            />
          </label>
        </div>
        <button type="submit" disabled={!!status} className="rounded-lg bg-black px-4 py-2 font-medium text-white disabled:opacity-50">
          {status ?? "Analyze this house"}
        </button>
      </form>

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {result?.warning && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{result.warning}</p>}

      {result && (
        <section className="mt-8 space-y-8">
          {result.listing && <ListingCard listing={result.listing} />}

          <div>
            <h2 className="mb-2 text-lg font-semibold">What the photos say</h2>
            <p>
              <span className="mr-2 rounded bg-neutral-100 px-2 py-0.5 text-sm font-medium uppercase">{result.assessment.overallCondition}</span>
              {result.assessment.summary}
            </p>
          </div>

          <PlanView plan={result.plan} />

          <div>
            <h2 className="mb-2 text-lg font-semibold">Room by room</h2>
            <ul className="grid gap-3 md:grid-cols-2">
              {result.assessment.rooms.map((r, i) => (
                <li key={i} className="rounded-xl border border-neutral-200 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.label}</span>
                    <span className="text-neutral-500">{r.condition}/5 · {r.finishLevel}{r.photoIndexes.length ? ` · photo ${r.photoIndexes.join(", ")}` : ""}</span>
                  </div>
                  {r.issues.length > 0 && <p className="mt-1 text-neutral-700"><span className="text-neutral-500">Fix:</span> {r.issues.join("; ")}</p>}
                  {r.keep.length > 0 && <p className="mt-1 text-neutral-700"><span className="text-neutral-500">Keep:</span> {r.keep.join("; ")}</p>}
                </li>
              ))}
            </ul>
          </div>

          <ReportView report={result.report} />
        </section>
      )}
    </div>
  );
}

function ListingCard({ listing }: { listing: ListingInfo }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4 text-sm">
      <div className="font-medium">{listing.address ?? listing.title ?? listing.url}</div>
      <div className="mt-1 text-neutral-500">
        {listing.host}
        {listing.price ? ` · ${money(listing.price)}` : ""}
        {listing.beds ? ` · ${listing.beds} bd` : ""}
        {listing.baths ? ` · ${listing.baths} ba` : ""}
        {listing.sqft ? ` · ${listing.sqft.toLocaleString()} sqft` : ""}
        {listing.photos.length ? ` · ${listing.photos.length} photo${listing.photos.length === 1 ? "" : "s"} from the page` : ""}
      </div>
      {listing.note && <div className="mt-1 text-amber-700">{listing.note}</div>}
    </div>
  );
}

function PlanView({ plan }: { plan: RenovationPlan }) {
  return (
    <div>
      <h2 className="mb-1 text-lg font-semibold">What to remodel, ranked by profit</h2>
      <p className="mb-3 text-sm text-neutral-600">
        As-is about {money(plan.asIsValue)}. Renovation can add up to {money(plan.uplift)}
        {Number.isFinite(plan.headroom) ? `, and the block will pay for about ${money(plan.headroom)} of it` : ""}.{" "}
        <span className="font-medium">{plan.finishAdvice}</span>
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-neutral-500">
            <tr>
              <th className="py-1 pr-3">Action</th>
              <th className="py-1 pr-3">Item</th>
              <th className="py-1 pr-3 text-right">Cost</th>
              <th className="py-1 pr-3 text-right">Adds</th>
              <th className="py-1 pr-3 text-right">Net</th>
              <th className="py-1">Why</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((i) => (
              <tr key={i.key} className={`border-t border-neutral-100 align-top ${i.action === "skip" ? "text-neutral-400" : ""}`}>
                <td className="py-1.5 pr-3">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium uppercase ${ACTION_STYLE[i.action]}`}>{i.action}</span>
                </td>
                <td className="py-1.5 pr-3 font-medium">{i.label}</td>
                <td className="py-1.5 pr-3 text-right whitespace-nowrap">{i.costLikely ? `${money(i.costLow)} – ${money(i.costHigh)}` : "—"}</td>
                <td className="py-1.5 pr-3 text-right">{i.valueAdded ? money(i.valueAdded) : "—"}</td>
                <td className={`py-1.5 pr-3 text-right ${i.net < 0 ? "text-red-600" : ""}`}>{i.costLikely || i.valueAdded ? money(i.net) : "—"}</td>
                <td className="py-1.5 text-neutral-600">{i.reason}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-neutral-300 font-semibold">
              <td className="py-1.5 pr-3" colSpan={2}>Total</td>
              <td className="py-1.5 pr-3 text-right whitespace-nowrap">{money(plan.totals.costLow)} – {money(plan.totals.costHigh)}</td>
              <td className="py-1.5 pr-3 text-right">{money(plan.totals.valueAdded)}</td>
              <td className={`py-1.5 pr-3 text-right ${plan.totals.net < 0 ? "text-red-600" : ""}`}>{money(plan.totals.net)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
