import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo } from "@/lib/listing/fetch-listing";
import { Block, money } from "./report-view";

export function ListingCard({ listing }: { listing: ListingInfo }) {
  return (
    <div className="card p-4 text-sm">
      <div className="font-medium">{listing.address ?? listing.title ?? listing.url}</div>
      <div className="mt-1 text-ink-500">
        {listing.host}
        {listing.price ? ` · ${money(listing.price)}` : ""}
        {listing.beds ? ` · ${listing.beds} bd` : ""}
        {listing.baths ? ` · ${listing.baths} ba` : ""}
        {listing.sqft ? ` · ${listing.sqft.toLocaleString()} sqft` : ""}
        {listing.photos.length ? ` · ${listing.photos.length} photo${listing.photos.length === 1 ? "" : "s"} from the page` : ""}
      </div>
      {listing.readFrom ? (
        <div className="mt-1 text-brand-700">
          Read from <a href={listing.readFrom.url} target="_blank" rel="noreferrer" className="underline">{listing.readFrom.host}</a>, the same MLS listing, because {listing.host} blocked the server.
        </div>
      ) : (
        listing.note && <div className="mt-1 text-amber-700">{listing.note}</div>
      )}
    </div>
  );
}

export function AssessmentView({ assessment }: { assessment: PhotoAssessment }) {
  return (
    <div className="space-y-6">
      <Block title="What the photos say">
        <p className="text-[15px] leading-relaxed">
          <span className="mr-2 inline-block rounded bg-ink-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">{assessment.overallCondition}</span>
          {assessment.summary}
        </p>
      </Block>

      <Block title="Room by room">
        <ul className="grid gap-3 md:grid-cols-2">
          {assessment.rooms.map((r, i) => (
            <li key={i} className="card p-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium">{r.label}</span>
                <span className="whitespace-nowrap text-xs text-ink-500">
                  <span className="mr-1 inline-block rounded bg-ink-100 px-1.5 py-0.5 font-semibold text-ink-700">{r.condition}/5</span>
                  {r.finishLevel}{r.photoIndexes.length ? ` · photo ${r.photoIndexes.join(", ")}` : ""}
                </span>
              </div>
              {r.issues.length > 0 && <p className="mt-2 text-ink-700"><span className="font-medium text-ink-900">Fix:</span> {r.issues.join("; ")}</p>}
              {r.keep.length > 0 && <p className="mt-1 text-ink-700"><span className="font-medium text-brand-700">Keep:</span> {r.keep.join("; ")}</p>}
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}
