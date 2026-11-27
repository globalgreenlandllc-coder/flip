import type { PhotoAssessment } from "@/lib/vision/schema";
import type { ListingInfo, ListingVia } from "@/lib/listing/fetch-listing";
import { SOURCE_WORDS, type FactKey } from "@/lib/listing/listing-facts";
import { AREA_TIME_ZONE } from "@/lib/area";
import { Block, money } from "./report-view";

const HOW_READ: Record<ListingVia, string> = {
  server: "Read by flip's server",
  browser: "Read through your browser",
  paste: "From the page you pasted",
  button: "Handed over by the button on the listing page",
  finder: "Filled in from a deal finder link",
};
/** The second way a listing was read, for what the first lacked. */
const ALSO_READ: Record<ListingVia, string> = {
  server: "by flip's server",
  browser: "through your browser",
  paste: "from the page you pasted",
  button: "by the button on the listing page",
  finder: "from a deal finder link",
};

const acres = (sqft: number) => (sqft >= 43_560 ? ` (${(sqft / 43_560).toFixed(2)} acres)` : "");
/** A label as it reads in the middle of a sentence: "Year built" becomes "year built", "HOA" and "MLS number" stay as they are. */
const inSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label);

/** How each fact reads on the card. Price, beds, baths and size are already in the line above. */
const FACT_WORDS: [FactKey, string, (v: number | string) => string][] = [
  ["yearBuilt", "Year built", (v) => String(v)],
  ["lotSqft", "Lot", (v) => `${Number(v).toLocaleString("en-US")} sqft${acres(Number(v))}`],
  ["propertyType", "Type", (v) => String(v)],
  ["stories", "Stories", (v) => String(v)],
  ["garage", "Garage spaces", (v) => String(v)],
  ["hoaMonthly", "HOA", (v) => `${money(Number(v))} a month`],
  ["taxAnnual", "Taxes", (v) => `${money(Number(v))} a year`],
  ["daysOnMarket", "Days on market", (v) => String(v)],
  ["status", "Status", (v) => String(v)],
  ["mlsId", "MLS number", (v) => String(v)],
];

/**
 * What the listing said, kept: the headline, how and when the page was read,
 * its other facts each with where on the page it came from, the labelled
 * lines of its detail sections, and its description as written.
 */
export function ListingCard({ listing }: { listing: ListingInfo }) {
  const facts = listing.facts ?? {};
  // Read from a line of its own or the page's data, against found in a sentence: the second kind is shown apart and never used for the numbers.
  const more = FACT_WORDS.filter(([key]) => facts[key] && !facts[key]!.loose);
  const mentioned = FACT_WORDS.filter(([key]) => facts[key]?.loose);
  const description = listing.description;
  const summaryOnly = description?.source === "meta";
  const ways = listing.read ? [listing.read.via, ...(listing.read.with ?? [])] : [];
  const readOn = listing.read ? new Date(listing.read.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: AREA_TIME_ZONE }) : null;
  return (
    <div className="card p-4 text-sm" data-listing-card>
      <div className="font-medium">{listing.address ?? listing.title ?? (listing.url || "Pasted listing page")}</div>
      <div className="mt-1 text-ink-500">
        {listing.host || (listing.read?.via === "finder" ? "deal finder" : "pasted page")}
        {listing.price ? ` · ${money(listing.price)}` : ""}
        {listing.beds ? ` · ${listing.beds} bd` : ""}
        {listing.baths ? ` · ${listing.baths} ba` : ""}
        {listing.sqft ? ` · ${listing.sqft.toLocaleString()} sqft` : ""}
        {listing.photos?.length ? ` · ${listing.photos.length} photo${listing.photos.length === 1 ? "" : "s"} from the page` : ""}
      </div>
      {listing.read && (
        <div className="mt-1 text-xs text-ink-500" data-listing-read>
          {HOW_READ[listing.read.via]}
          {readOn ? ` on ${readOn}` : ""}
          {listing.read.with?.length ? `; what that left out was read ${listing.read.with.map((via) => ALSO_READ[via]).join(" and ")}` : ""}.
          {ways.includes("button") ? " The button hands over only the first part of the page's text." : ""}
        </div>
      )}
      {listing.readFrom ? (
        <div className="mt-1 text-brand-700">
          {listing.read?.via === "finder" ? (
            <>
              Its page and photos were read from <a href={listing.readFrom.url} target="_blank" rel="noreferrer" className="underline">{listing.readFrom.host}</a>, found by its address: the deal finder gives no photos.
            </>
          ) : (
            <>
              Read from <a href={listing.readFrom.url} target="_blank" rel="noreferrer" className="underline">{listing.readFrom.host}</a>, the same MLS listing, because {listing.host} blocked the server.
            </>
          )}
        </div>
      ) : (
        listing.note && <div className="mt-1 text-amber-700">{listing.note}</div>
      )}

      {more.length > 0 && (
        <div className="mt-4" data-listing-facts>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">What else the listing says</div>
          <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {more.map(([key, label, words]) => (
              <div key={key} className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1">
                <dt className="text-ink-700">{label}</dt>
                <dd className="text-right">
                  <span className="font-medium">{words(facts[key]!.value)}</span>
                  <span className="block text-[11px] text-ink-500">
                    from {SOURCE_WORDS[facts[key]!.source]}
                    {facts[key]!.seen ? `: “${facts[key]!.seen}”` : ""}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      {mentioned.length > 0 && (
        <div className="mt-4" data-listing-loose>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            Also mentioned in its text <span className="normal-case font-normal">· found in a sentence, not on a line of its own, so not used for the numbers</span>
          </div>
          <ul className="mt-1.5 space-y-1">
            {mentioned.map(([key, label, words]) => (
              <li key={key} className="text-ink-700">
                {facts[key]!.seen ? `“${facts[key]!.seen}”` : label} <span className="text-ink-500">· read as {inSentence(label)} {words(facts[key]!.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {listing.details && listing.details.length > 0 && (
        <details className="mt-4" data-listing-details>
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-ink-500">From the listing&apos;s detail sections ({listing.details.length})</summary>
          <dl className="mt-1.5 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {listing.details.map((d, i) => (
              <div key={i} className="flex items-baseline justify-between gap-3 border-b border-ink-100 py-1">
                <dt className="text-ink-700">{d.label}</dt>
                <dd className="text-right font-medium">{d.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {description && (
        <div className="mt-4" {...(summaryOnly ? { "data-listing-summary": true } : { "data-listing-description": true })}>
          <div className="text-xs font-medium uppercase tracking-wide text-ink-500">
            {summaryOnly ? "The page's summary" : description.unsure ? "Probably the listing's description" : "The listing's description"}{" "}
            <span className="normal-case font-normal">
              ·{" "}
              {summaryOnly
                ? "what a link preview shows, not the description itself"
                : description.unsure
                  ? "the first long paragraph on the page, which had no heading to go by"
                  : `as written, from ${SOURCE_WORDS[description.source]}`}
              {description.cut ? ` · its first ${description.text.length.toLocaleString("en-US")} characters` : ""}
            </span>
          </div>
          <p className="mt-1.5 max-h-48 overflow-y-auto whitespace-pre-line rounded-lg bg-ink-100/50 p-3 leading-relaxed text-ink-900">{description.text}</p>
        </div>
      )}
      {(!description || summaryOnly) && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" data-listing-no-description>
          The listing&apos;s description did not come through, so nothing it says (as-is, cash only, septic, tenants) is on record here. To keep it: open the listing, press ⌘A then ⌘C, and paste the page into the form.
        </p>
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
