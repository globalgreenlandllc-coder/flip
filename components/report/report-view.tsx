import type { GateReason, PropertyFacts, Report, RiskFlag } from "@/lib/engine/types";
import type { DataSource } from "@/lib/data/house-data";
import type { SubjectKey, SubjectSources } from "@/lib/listing/subject";
import { AREA_TIME_ZONE } from "@/lib/area";
import { VerdictBadge } from "@/components/ui/verdict";
import { DemoTag } from "@/components/ui/demo";

/** Risk flags that come from the photos. */
const FROM_PHOTOS = new Set(["PHOTO_RED_FLAG", "VERIFY_ON_SITE"]);
/** Risk flags that follow the year the house was built, wherever that year came from. */
const FROM_AGE = new Set(["PRE_1978", "OLD_SYSTEMS"]);

/**
 * Is this flag as made up as the demo's property record and sales are? Told
 * by what kind of flag it is first: one worked out from the sales is made up
 * whatever a saved result says its basis was. Only an age flag can be real
 * without the photos, when the year came from the listing or the request.
 */
function madeUp(flag: RiskFlag): boolean {
  if (FROM_PHOTOS.has(flag.code)) return false;
  if (FROM_AGE.has(flag.code)) return flag.basis !== "listing" && flag.basis !== "caller";
  return true;
}

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** A day as a reader says it: "May 5, 2026". Dates here are days, not moments, so they are read in UTC. */
/** A day as written (a sale's date), or the day a moment fell on by the area's clock (when something was read). */
const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: iso.length === 10 ? "UTC" : AREA_TIME_ZONE });
const miles = (n: number) => `${n} mile${n === 1 ? "" : "s"}`;

export function Stat({ label, value, sub, tone, demo = false }: { label: string; value: string; sub?: string; tone?: "good" | "bad"; demo?: boolean }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
        {demo && <DemoTag />}
      </div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "bad" ? "text-pass" : tone === "good" ? "text-go" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function Block({ title, children, aside, demo = false }: { title: string; children: React.ReactNode; aside?: React.ReactNode; demo?: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">
          {title}
          {demo && <DemoTag className="ml-2" />}
        </h2>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr className={`border-t border-ink-100 ${bold ? "font-semibold" : ""}`}>
      <td className="py-1.5">{k}</td>
      <td className="py-1.5 text-right tabular-nums">{v}</td>
    </tr>
  );
}

/**
 * Why a GO was withheld and what would clear it (lib/engine/gate.ts). Shown
 * under a CHECK FIRST verdict wherever the verdict is shown.
 */
export function WithheldNote({ reasons }: { reasons?: GateReason[] }) {
  if (!reasons?.length) return null;
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 text-sm" data-withheld>
      <p className="font-semibold">What would make this a GO</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-5 leading-relaxed text-ink-700">
        {reasons.map((r) => (
          <li key={r.code}>
            {r.message} <span className="text-ink-900">Clears with: {r.clears}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What a fact is called when it is missing. */
const NAMES: Record<SubjectKey, string> = { sqft: "living area", beds: "bedrooms", baths: "bathrooms", yearBuilt: "year built", lotSqft: "lot size", garage: "garage spaces" };

/**
 * The house the numbers are about, said by where each part came from: the
 * listing, the photos, or the provider's property record. While that record
 * is made up, its part carries the DEMO tag and the rest does not. A fact
 * nobody gave is named as not known, never shown as a number.
 */
function SubjectLine({ subject, sources, conditionFrom, demo, record }: { subject: PropertyFacts; sources?: SubjectSources; conditionFrom?: "photos" | "record"; demo: boolean; record?: string }) {
  const words: Record<SubjectKey, string | null> = {
    sqft: `${subject.sqft.toLocaleString()} sqft`,
    beds: subject.beds === null ? null : `${subject.beds} bd`,
    baths: subject.baths === null ? null : `${subject.baths} ba`,
    yearBuilt: subject.yearBuilt === null ? null : `built ${subject.yearBuilt}`,
    lotSqft: subject.lotSqft === null ? null : `lot ${subject.lotSqft.toLocaleString()} sqft`,
    garage: subject.garage === null ? null : `garage ${subject.garage}`,
  };
  if (!sources) {
    // A result from before sources were kept, or one with no listing behind it: every fact is the record's.
    return (
      <p className="text-sm text-ink-500" data-subject>
        Subject: {[words.sqft, [words.beds, words.baths].filter(Boolean).join(" / "), words.yearBuilt, subject.condition, subject.submarket].filter(Boolean).join(" · ")}
        {demo && (
          <>
            <DemoTag className="ml-2" />{" "}
            <span className="text-xs">
              {conditionFrom === "photos" ? "the year built, the area and anything the listing did not give are from a made-up property record; the condition is read off the photos" : "a made-up property record"}
            </span>
          </>
        )}
      </p>
    );
  }
  // In the order a listing says them: size, rooms, age, land, parking.
  const order: SubjectKey[] = ["sqft", "beds", "baths", "yearBuilt", "lotSqft", "garage"];
  const from = (wanted: SubjectSources[SubjectKey]) => order.filter((k) => sources[k] === wanted).flatMap((k) => words[k] ?? []);
  const given = from("listing");
  const sent = from("caller");
  const real = !demo && Boolean(record);
  // A real record's area is its zip code; one without a zip has nothing to say here.
  const area = !real ? [`area ${subject.submarket}`] : /^\d{5}$/.test(subject.submarket) ? [`zip code ${subject.submarket}`] : [];
  const recorded = [...from("record"), ...(conditionFrom === "photos" ? [] : [`${subject.condition} condition`]), ...area];
  const unknown = order.filter((k) => words[k] === null).map((k) => NAMES[k]);
  return (
    <div className="space-y-1 text-sm text-ink-500" data-subject>
      {given.length > 0 && (
        <p data-subject-given>
          <span className="font-medium text-ink-700">From the listing:</span> {given.join(" · ")}
        </p>
      )}
      {sent.length > 0 && (
        <p data-subject-sent>
          <span className="font-medium text-ink-700">Sent with the request:</span> {sent.join(" · ")}
        </p>
      )}
      {conditionFrom === "photos" && (
        <p>
          <span className="font-medium text-ink-700">From the photos:</span> {subject.condition} condition
        </p>
      )}
      <p data-subject-record>
        <span className="font-medium text-ink-700">{demo ? "From a made-up property record" : real ? `From the public record (${record})` : "From the property record"}:</span> {recorded.join(" · ")}
        {demo && <DemoTag className="ml-2" />}
      </p>
      {unknown.length > 0 && (
        <p data-subject-unknown>
          <span className="font-medium text-ink-700">Not known:</span> {unknown.join(" · ")}. Sold homes are not adjusted for what is not known{subject.baths === null ? "; the remodel plan prices the bathrooms as two, and says so on that line" : ""}.
        </p>
      )}
    </div>
  );
}

/** Where a real result's record and sold homes came from, and how fresh they are. */
function SourceBlock({ data }: { data: DataSource }) {
  const { record, search } = data;
  return (
    <Block title="Where these numbers come from">
      <div className="card space-y-2 p-4 text-sm leading-relaxed text-ink-700" data-source>
        <p data-source-record>
          <span className="font-medium text-ink-900">The house:</span> the public record for {record.address}
          {record.propertyType ? ` (${record.propertyType.toLowerCase()}${record.county ? `, ${record.county} County` : ""})` : ""}
          {/* A sale with its day and no price is a sale on record all the same: said as that, not as "no sale". */}
          {record.lastSale
            ? `. It last sold on ${day(record.lastSale.date)} for ${money(record.lastSale.price)}`
            : record.soldOn
              ? `. It last sold on ${day(record.soldOn)}; the record does not give the price`
              : ". The record gives no sale of it"}
          . Read {day(record.readAt)}.
        </p>
        <p data-source-sales>
          <span className="font-medium text-ink-900">Sold homes:</span> {search.found} {search.sampled ? "read, of the homes of similar size that sold" : "of similar size sold"} within {miles(search.radiusMiles)} in the last {search.months} months
          {search.usable < search.found ? `, ${search.usable} of them with a price that can be used` : ""}
          {search.newestSale ? `. The newest sale among them is from ${day(search.newestSale)}` : ""}. Read {day(search.readAt)}.
          {/* Only a radius that came back whole says the nearest are all here. A deal saved before that was kept says the lesser thing. */}
          {search.sampled
            ? typeof search.wholeWithinMiles === "number"
              ? ` More matched than can be read at once: every one within ${miles(search.wholeWithinMiles)} was read, and a part of those further out.`
              : " More matched than can be read at once: these are a part of them, and may not include the nearest."
            : ""}
          {search.stoppedEarly ? " The search could not be taken wider this time." : ""}
        </p>
        <p className="text-xs text-ink-500">
          Source: {data.name}, which gathers county public records. A sale shows up there weeks to months after it closes, and a record does not say what condition a house sold in. These are records, not an appraisal.
        </p>
      </div>
    </Block>
  );
}

/**
 * The full report body. The verdict row can be hidden when the caller renders
 * its own header. `demo` marks every number that comes from made-up sales;
 * `untested` marks a result built on real sold prices by a method not yet
 * accuracy-tested. `sources` says where each fact about the house came from,
 * when that was kept, and `data` where a real result's records came from.
 */
export function ReportView({
  report,
  hideVerdict = false,
  demo = false,
  untested = false,
  sources,
  conditionFrom,
  data,
}: {
  report: Report;
  hideVerdict?: boolean;
  demo?: boolean;
  untested?: boolean;
  sources?: SubjectSources;
  conditionFrom?: "photos" | "record";
  data?: DataSource;
}) {
  const { subject, arv, deal, riskFlags } = report;
  // Real sales have an address and a date a reader can look up, and no condition; the demo's have neither address nor meaning.
  const real = arv.comps.some((c) => c.sale.address);
  return (
    <section className="space-y-8">
      {!hideVerdict && (
        <>
          <div className="flex flex-wrap items-center gap-4">
            <VerdictBadge verdict={deal.verdict} size="lg" demo={demo} untested={untested} />
            <p className="max-w-2xl text-lg">{deal.decidingFactor}</p>
          </div>
          <WithheldNote reasons={deal.withheld} />
        </>
      )}

      <SubjectLine subject={subject} sources={sources} conditionFrom={conditionFrom} demo={demo} record={data?.name} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat demo={demo} label="ARV" value={money(arv.point)} sub={`${money(arv.low)} – ${money(arv.high)} · ${arv.confidence}${arv.cappedByCeiling ? " · capped" : ""}${untested ? " · accuracy not measured yet" : ""}`} />
        <Stat demo={demo} label="Max offer" value={money(deal.maxAllowableOffer)} sub={`asking is ${money(Math.abs(deal.askingVsMao))} ${deal.askingVsMao > 0 ? "above" : "below"}`} tone={deal.askingVsMao > 0 ? "bad" : "good"} />
        <Stat demo={demo} label="Profit at asking" value={money(deal.profit)} sub={Number.isNaN(deal.roi) ? undefined : `${Math.round(deal.roi * 100)}% on cash`} tone={deal.profit < 0 ? "bad" : undefined} />
        <Stat
          demo={demo}
          label="Ceiling"
          value={arv.ceiling ? money(arv.ceiling.value) : "unknown"}
          sub={arv.ceiling ? `${money(arv.ceiling.pricePerSqft)}/sqft · n=${arv.ceiling.sampleSize}` : arv.ceilingSetAside ? "the homes compared sold above the top of the sold homes found around it" : real ? "too few sales to tell" : "thin submarket sample"}
        />
      </div>

      <Block title="Why" demo={demo}>
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
          {report.narrative.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      </Block>

      {data && <SourceBlock data={data} />}

      <Block demo={demo} title={`${real ? "Sold homes compared" : "Comps"} (${arv.comps.length}) within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo`}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm" data-comps={real ? "real" : "demo"}>
            <thead className="bg-ink-100/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                {(real ? ["Address", "Sold", "Sold for", "Adjusted", "Sqft", "Dist", "Gross adj", "Weight", "Adjustments"] : ["Sold", "Adjusted", "Sqft", "Condition", "Dist", "Age", "Gross adj", "Weight", "Adjustments"]).map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arv.comps.map((c) => {
                const adjustments = c.adjustments.map((a) => `${a.factor} ${a.amount >= 0 ? "+" : "−"}${money(Math.abs(a.amount))}`).join(", ");
                // What the records do not say is named, so no reader takes a missing line for "the same".
                const notCompared = c.notCompared?.length ? `not compared (not on record): ${c.notCompared.join(", ")}` : "";
                return (
                  <tr key={c.sale.id} className="border-t border-ink-100 align-top">
                    {real && <td className="px-3 py-2">{c.sale.address ?? "address not given"}</td>}
                    {real && <td className="px-3 py-2 whitespace-nowrap">{day(c.sale.saleDate)}</td>}
                    <td className="px-3 py-2 tabular-nums">{money(c.sale.price)}</td>
                    <td className="px-3 py-2 font-medium tabular-nums">{money(c.adjustedPrice)}</td>
                    <td className="px-3 py-2">{c.sale.sqft.toLocaleString()}</td>
                    {!real && <td className="px-3 py-2">{c.sale.condition}</td>}
                    <td className="px-3 py-2 whitespace-nowrap">{c.distanceMiles.toFixed(2)} mi</td>
                    {!real && <td className="px-3 py-2 whitespace-nowrap">{c.monthsAgo.toFixed(1)} mo</td>}
                    <td className="px-3 py-2">{pct(c.grossAdjustmentPct)}</td>
                    <td className="px-3 py-2">{c.weight.toFixed(3)}</td>
                    <td className="px-3 py-2 text-ink-500">
                      {adjustments}
                      {adjustments && notCompared ? "; " : ""}
                      {notCompared}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {real && <p className="mt-2 text-xs text-ink-500">Each sale is a public record you can look up by its address. The adjustment amounts are placeholder rates, not yet fitted to this area&apos;s sales.</p>}
      </Block>

      <div className="grid gap-8 md:grid-cols-2">
        <Block title="Deal" demo={demo}>
          <div className="card p-4">
            <table className="w-full text-sm">
              <tbody>
                <Row k="Purchase" v={money(deal.purchasePrice)} />
                <Row k="Rehab incl. reserve" v={money(deal.rehabWithReserve)} />
                <Row k="Holding" v={money(deal.holdingCost)} />
                <Row k="Financing" v={money(deal.financingCost)} />
                <Row k="Closing (buy + sell)" v={money(deal.closingBuy + deal.closingSell)} />
                <Row k="All-in" v={money(deal.totalCost)} bold />
                <Row k="ARV" v={money(deal.arv)} />
                <Row k="Profit" v={money(deal.profit)} bold />
              </tbody>
            </table>
          </div>
        </Block>

        <Block title="Sensitivity: profit" demo={demo}>
          <div className="card p-4">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-ink-500">
                <tr>
                  <th className="py-1 text-left font-medium">ARV \ rehab</th>
                  <th className="py-1 text-right font-medium">+0%</th>
                  <th className="py-1 text-right font-medium">+10%</th>
                  <th className="py-1 text-right font-medium">+20%</th>
                </tr>
              </thead>
              <tbody>
                {[0, -0.05, -0.1].map((a) => (
                  <tr key={a} className="border-t border-ink-100">
                    <td className="py-1.5">{a * 100}%</td>
                    {deal.sensitivity
                      .filter((s) => s.arvDeltaPct === a)
                      .map((s) => (
                        <td key={s.rehabDeltaPct} className={`py-1.5 text-right tabular-nums ${s.profit < 0 ? "text-pass" : ""}`}>{money(s.profit)}</td>
                      ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>
      </div>

      {riskFlags.length > 0 && (
        <Block title="Risk flags">
          <ul className="card divide-y divide-ink-100">
            {riskFlags.map((f, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-sm">
                <span className="mt-0.5 h-fit shrink-0 rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-700">{f.code}</span>
                <span>
                  {f.message}
                  {/* A flag worked out from the made-up record or sales is as made up as they are; one read off the photos or the listing is real. */}
                  {demo && madeUp(f) && <DemoTag className="ml-2" />}
                </span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </section>
  );
}
