"use client";

import { useMemo, useState } from "react";
import type { RepairLevel, ScreenResult } from "@/lib/engine/screen";
import type { DealSearch, DealSearchAnswer, DealSearchEstimate, FoundHome, HomeType } from "@/lib/data/deal-finder";
import { parseMoney } from "@/lib/finder/money";
import { browserNotes, noteFullAnalysis } from "@/lib/finder/hand-off";
import { DealMap, type MapTiles } from "./deal-map";
import { HEAT_WORDS, analyzeHref, money, zillowHref, type MapHome } from "./shared";

type Answer = DealSearchAnswer & { untested: true; search: DealSearch };

const MAX_CHECK = 5;
const REPAIRS: { level: RepairLevel; label: string; hint: string }[] = [
  { level: "light", label: "Light", hint: "$18–35 a sq ft: paint, floors, fixtures" },
  { level: "medium", label: "Medium", hint: "$30–60 a sq ft: kitchen, baths, floors" },
  { level: "heavy", label: "Heavy", hint: "$55–100 a sq ft: systems, roof, layout" },
];
const TYPES: HomeType[] = ["Single Family", "Townhouse", "Condo"];
const HEAT_STYLE: Record<MapHome["heat"], string> = {
  hot: "bg-orange-600 text-white",
  warm: "bg-amber-100 text-amber-900",
  cold: "bg-ink-100 text-ink-600",
  unknown: "bg-white text-ink-500 ring-1 ring-ink-200",
};

const day = (iso: string) => new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The numbers a home is shown with: its closer look's when it has had one, its first look's otherwise. */
const shownScreen = (h: FoundHome): ScreenResult => (h.checked?.status === "ok" && h.checked.screen ? h.checked.screen : h.screen);

export function Finder({ connected, tiles }: { connected: boolean; tiles: MapTiles | null }) {
  const [zips, setZips] = useState("");
  const [min, setMin] = useState("150000");
  const [max, setMax] = useState("600000");
  const [target, setTarget] = useState("60000");
  const [repair, setRepair] = useState<RepairLevel>("medium");
  const [type, setType] = useState<HomeType>("Single Family");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  /** A search that may cost lookups, waiting for the person's yes: what it is, and what it may cost. */
  const [pending, setPending] = useState<{ body: Record<string, unknown>; estimate: DealSearchEstimate } | null>(null);

  async function post<T = Answer>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (!res.ok || !json) throw new Error(json?.error ?? `${res.status} ${res.statusText}`);
    return json;
  }

  /** The form as a search, or a sentence saying what is wrong with it. */
  function searchFromForm(): Record<string, unknown> | string {
    const list = zips.split(/[\s,;]+/).filter(Boolean);
    if (list.length === 0) return "Type one or more zip codes, like 98103, 98117.";
    if (list.some((z) => !/^\d{5}$/.test(z))) return "A zip code is five digits.";
    if (list.length > 5) return "Search at most 5 zip codes at a time.";
    const [low, high, wanted] = [parseMoney(min), parseMoney(max), parseMoney(target)];
    if (low === null || high === null) return "Type the prices as numbers, like 250000 or 250k.";
    if (low > high) return "The lowest price is above the highest.";
    if (wanted === null) return "Type the profit you want as a number, like 60000 or 60k.";
    if (wanted < 1_000) return "The profit you want must be at least $1,000.";
    return { zips: list, price: { min: low, max: high }, targetProfit: wanted, repair, propertyType: type };
  }

  async function run(body: Record<string, unknown>) {
    setPending(null);
    const list = body.zips as string[];
    setBusy(`Searching ${list.join(", ")}: reading the homes for sale and the homes sold there in the last year…`);
    try {
      setAnswer(await post("/api/v1/deals/find", body));
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  /** First what the search may cost (asking nothing); a search that costs nothing runs at once, any other waits for a yes. */
  async function search(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirming(false);
    setPending(null);
    const body = searchFromForm();
    if (typeof body === "string") return setError(body);
    setBusy("Working out what this search may cost…");
    try {
      const { estimate } = await post<{ estimate: DealSearchEstimate }>("/api/v1/deals/find", { ...body, estimate: true });
      setBusy(null);
      if (estimate.upTo === 0) return run(body);
      setPending({ body, estimate });
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const homes = useMemo(() => answer?.homes ?? [], [answer]);
  const toCheck = homes.filter((h) => h.screen.heat === "hot" && h.checked?.status !== "ok").slice(0, MAX_CHECK);
  const left = answer?.lookups ? Math.max(0, Math.min(answer.lookups.of - answer.lookups.used, answer.lookups.myShare - answer.lookups.mine)) : null;

  async function check() {
    if (!answer) return;
    setConfirming(false);
    setError(null);
    setBusy(`Looking at ${toCheck.length} hot home${toCheck.length === 1 ? "" : "s"} one by one: each one's own record and the homes sold right around it…`);
    try {
      setAnswer(await post("/api/v1/deals/check", { ...answer.search, price: { min: answer.search.price[0], max: answer.search.price[1] }, ids: toCheck.map((h) => h.listing.id) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const mapHomes: MapHome[] = useMemo(
    () =>
      homes.map((h) => {
        const s = shownScreen(h);
        return { id: h.listing.id, address: h.listing.address, lat: h.listing.lat, lng: h.listing.lng, price: h.listing.price, beds: h.listing.beds, baths: h.listing.baths, sqft: h.listing.sqft, listingType: h.listing.listingType, heat: s.heat, profit: s.profit, maxOffer: s.maxOffer, value: s.arv ? { point: s.arv.point, confidence: s.arv.confidence.toLowerCase(), sales: s.arv.comps } : null, why: h.why };
      }),
    [homes],
  );
  const count = (heat: MapHome["heat"]) => mapHomes.filter((h) => h.heat === heat).length;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-relaxed text-amber-900" data-finder-untested>
        <span className="font-semibold">A first look, not a verdict.</span> Each home is compared with real homes of its kind sold within a mile of it in the last year, in the zip codes you search (public records run about three months behind, and do not say what shape a home sold in), by a method not yet tested against real flips. No photos are read: the repair is the one you choose below, and the value is what homes like it sold for, as if the work brought it up to them. A full analysis may come out lower once its renovation plan is priced. A hot home is a home to look at, never a deal to make. Check it with a full analysis before you offer.
      </div>

      {!connected && (
        <div className="card p-4 text-sm text-ink-700" data-finder-off>
          Real sold prices are not connected on this site, so the deal finder cannot search.
        </div>
      )}

      <form onSubmit={search} className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-6" data-finder-form>
        <div className="sm:col-span-2 lg:col-span-2">
          <label className="label" htmlFor="zips">Zip codes (up to 5)</label>
          <input id="zips" className="input" value={zips} onChange={(e) => setZips(e.target.value)} placeholder="98103, 98117" inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="min">Price from</label>
          <input id="min" className="input" value={min} onChange={(e) => setMin(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="max">Price to</label>
          <input id="max" className="input" value={max} onChange={(e) => setMax(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="target">Profit you want</label>
          <input id="target" className="input" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="numeric" />
        </div>
        <div>
          <label className="label" htmlFor="type">Kind of home</label>
          <select id="type" className="input" value={type} onChange={(e) => setType(e.target.value as HomeType)}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <fieldset className="sm:col-span-2 lg:col-span-6">
          <legend className="label">How much repair you expect</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {REPAIRS.map((r) => (
              <label key={r.level} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm ${repair === r.level ? "border-ink-950 bg-ink-50" : "border-ink-200"}`}>
                <input type="radio" name="repair" value={r.level} checked={repair === r.level} onChange={() => setRepair(r.level)} className="mt-1" />
                <span>
                  <span className="font-medium">{r.label}</span>
                  <span className="block text-xs text-ink-500">{r.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-6">
          <button type="submit" className="btn-accent" disabled={Boolean(busy) || !connected}>
            Find deals
          </button>
          <span className="text-xs text-ink-500">A zip code and kind of home not searched today uses 2 or 3 sold-price lookups; the same again today uses none, whatever the prices, profit or repair. RenoFlip says what a search may cost before it runs.</span>
        </div>
      </form>

      {pending && (
        <div className="card space-y-3 p-4 text-sm" data-finder-search-confirm>
          <p>
            This search may use up to {pending.estimate.upTo} sold-price lookup{pending.estimate.upTo === 1 ? "" : "s"}
            {pending.estimate.zips.length > 1 ? ` (${pending.estimate.zips.map((z) => `${z.zip}: ${z.upTo}`).join(", ")})` : ""}
            {pending.estimate.lookups
              ? `. In the last 31 days ${pending.estimate.lookups.used} of RenoFlip's ${pending.estimate.lookups.of} were used, ${pending.estimate.lookups.mine} of your ${pending.estimate.lookups.myShare} by you`
              : ""}
            . The same search again today will use none.
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn-primary" onClick={() => run(pending.body)}>Search</button>
            <button type="button" className="btn-secondary" onClick={() => setPending(null)}>Cancel</button>
          </div>
        </div>
      )}

      {busy && <p className="text-sm text-ink-700" data-finder-busy>{busy}</p>}
      {error && <p className="text-sm text-red-700" data-finder-error>{error}</p>}

      {answer && (
        <section className="space-y-4" data-finder-results>
          {answer.areas.filter((a) => a.status !== "ok").map((a) => (
            <p key={a.zip} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-finder-area-message>
              {a.message}
            </p>
          ))}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="text-sm text-ink-700" data-finder-summary>
              <span className="font-medium text-ink-950">
                {homes.length} home{homes.length === 1 ? "" : "s"} for sale between {money(answer.search.price[0])} and {money(answer.search.price[1])}
              </span>
              {homes.length > 0 && ` · ${count("hot")} hot · ${count("warm")} warm`}
              <span className="block text-xs text-ink-500" data-finder-rule>
                Hot: at least {money(answer.search.targetProfit)} left at the asking price after a {answer.search.repair} repair and every cost of the deal. &quot;Full analysis&quot; opens a home in a new tab and runs the whole analysis, photos and all; it uses one of your analyses for the month. A home near the edge of a zip code is compared only with the zip codes searched: add the one next to it for a fuller look. The sales behind a value are listed when a home is checked.
              </span>
              {answer.inRange > homes.length && <span className="block text-xs text-ink-500">Showing the {homes.length.toLocaleString("en-US")} most promising of {answer.inRange.toLocaleString("en-US")}.</span>}
              <span className="block text-xs text-ink-500">
                {answer.areas.filter((a) => a.status === "ok").map((a) => `${a.zip}: ${a.listings.found} for sale${a.listings.sampled ? " (more were for sale than RenoFlip reads at once: these are a part)" : ""}, ${a.sales.usable} sold in the last year${a.sales.sampled ? " (more sold than RenoFlip reads at once: a part)" : ""}${a.sales.newestSale ? `, newest sale ${day(a.sales.newestSale)}` : ""}`).join(" · ")}
              </span>
              {answer.lookups && (
                <span className="block text-xs text-ink-500" data-finder-lookups>
                  Sold-price lookups in the last 31 days: {answer.lookups.used} of {answer.lookups.of} used; yours: {answer.lookups.mine} of {answer.lookups.myShare}.
                </span>
              )}
            </div>
            {toCheck.length > 0 && !confirming && (
              <button type="button" className="btn-secondary" onClick={() => setConfirming(true)} disabled={Boolean(busy)} data-finder-check>
                Check the {toCheck.length} hot one{toCheck.length === 1 ? "" : "s"}
              </button>
            )}
          </div>

          {answer.notFound && answer.notFound.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" data-finder-not-found>
              {answer.notFound.length === 1 ? "One of the homes you chose is" : `${answer.notFound.length} of the homes you chose are`} no longer in the search as it was kept today. Search again first.
            </p>
          )}

          {confirming && (
            <div className="card space-y-3 p-4 text-sm" data-finder-confirm>
              <p>
                RenoFlip will look at {toCheck.length === 1 ? "this hot home" : `these ${toCheck.length} hot homes`} one by one: each one&apos;s own public record and the homes sold right around it. That uses about 2 lookups a home, up to 5, so about {toCheck.length * 2} to {toCheck.length * 5}
                {left !== null ? `, of the ${left} you have left` : ""}. It works from the search as it was kept, and does not read photos.
              </p>
              <div className="flex gap-2">
                <button type="button" className="btn-primary" onClick={check}>Check them</button>
                <button type="button" className="btn-secondary" onClick={() => setConfirming(false)}>Cancel</button>
              </div>
            </div>
          )}

          {homes.length > 0 && <DealMap homes={mapHomes} selected={selected} onSelect={setSelected} tiles={tiles} />}

          {homes.length > 0 ? (
            <>
              {/* Wide screens: a table. */}
              <div className="card hidden overflow-x-auto md:block">
                <table className="w-full text-sm" data-finder-list>
                  <thead className="bg-ink-50 text-left text-xs uppercase tracking-wide text-ink-500">
                    <tr>
                      <th className="px-3 py-2"> </th>
                      <th className="px-3 py-2">Home</th>
                      <th className="px-3 py-2 text-right">Asking</th>
                      <th className="px-3 py-2 text-right">Similar homes sold for</th>
                      <th className="px-3 py-2 text-right">Repair</th>
                      <th className="px-3 py-2 text-right">Profit at asking</th>
                      <th className="px-3 py-2 text-right">Most to pay</th>
                      <th className="px-3 py-2"> </th>
                    </tr>
                  </thead>
                  <tbody>
                    {homes.map((h) => {
                      const s = shownScreen(h);
                      const l = h.listing;
                      return (
                        <tr key={l.id} className={`border-t border-ink-100 align-top ${selected === l.id ? "bg-ink-50" : ""}`} data-finder-home={s.heat} onClick={() => setSelected(l.id)}>
                          <td className="px-3 py-2">
                            <HeatBadge heat={s.heat} />
                          </td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{l.address}</div>
                            <HomeFacts home={h} />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{money(l.price)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {s.arv ? (
                              <>
                                {money(s.arv.point)}
                                <div className="text-xs text-ink-500">{s.arv.confidence.toLowerCase()} confidence · {s.arv.comps} sale{s.arv.comps === 1 ? "" : "s"}</div>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.arv ? money(s.rehab.likely) : "—"}</td>
                          <td className={`px-3 py-2 text-right font-semibold tabular-nums ${profitTone(s)}`}>{s.profit !== null ? money(s.profit) : "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{s.maxOffer !== null ? money(s.maxOffer) : "—"}</td>
                          <td className="whitespace-nowrap px-3 py-2 text-xs">
                            <HomeLinks home={h} attr="data-finder-analyze" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Phones: a card for each home. */}
              <ul className="space-y-3 md:hidden" data-finder-cards>
                {homes.map((h) => {
                  const s = shownScreen(h);
                  const l = h.listing;
                  return (
                    <li key={l.id} className={`card p-4 text-sm ${selected === l.id ? "ring-2 ring-ink-950" : ""}`} data-finder-card={s.heat} onClick={() => setSelected(l.id)}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium">{l.address}</div>
                          <HomeFacts home={h} inCard />
                        </div>
                        <HeatBadge heat={s.heat} />
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
                        <CardFigure label="Asking" value={money(l.price)} />
                        <CardFigure label="Similar homes sold for" value={s.arv ? money(s.arv.point) : "—"} note={s.arv ? `${s.arv.confidence.toLowerCase()} confidence · ${s.arv.comps} sale${s.arv.comps === 1 ? "" : "s"}` : undefined} />
                        <CardFigure label="Repair" value={s.arv ? money(s.rehab.likely) : "—"} />
                        <CardFigure label="Profit at asking" value={s.profit !== null ? money(s.profit) : "—"} tone={profitTone(s)} />
                        <CardFigure label="Most to pay" value={s.maxOffer !== null ? money(s.maxOffer) : "—"} />
                      </dl>
                      <div className="mt-3 text-xs">
                        <HomeLinks home={h} attr="data-finder-card-analyze" />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            answer.connected && <p className="text-sm text-ink-700" data-finder-empty>No homes for sale in that price range in {answer.search.zips.join(", ")}.</p>
          )}
        </section>
      )}
    </div>
  );
}

const profitTone = (s: ScreenResult) => (s.heat === "hot" ? "text-orange-700" : s.profit !== null && s.profit < 0 ? "text-ink-500" : "");

function HeatBadge({ heat }: { heat: MapHome["heat"] }) {
  return <span className={`inline-block shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${HEAT_STYLE[heat]}`}>{HEAT_WORDS[heat]}</span>;
}

/** A home's rooms, size, year and days listed; why it could not be valued; and what its closer look was against. */
function HomeFacts({ home: h, inCard = false }: { home: FoundHome; inCard?: boolean }) {
  const l = h.listing;
  return (
    <>
      <div className="text-xs text-ink-500">
        {[l.beds !== null ? `${l.beds} bd` : null, l.baths !== null ? `${l.baths} ba` : null, l.sqft !== null ? `${l.sqft.toLocaleString("en-US")} sqft` : null, l.yearBuilt ? `built ${l.yearBuilt}` : null, l.daysOnMarket !== null ? `${l.daysOnMarket} days listed` : null].filter(Boolean).join(" · ")}
        {l.listingType && l.listingType !== "Standard" ? <span className="font-medium text-ink-700"> · {l.listingType}</span> : null}
      </div>
      {h.why && <div className="text-xs text-ink-500">{h.why}</div>}
      {h.checked && (
        <div className="mt-1 text-xs" {...{ [inCard ? "data-finder-card-checked" : "data-finder-checked"]: h.checked.status }}>
          {h.checked.status === "ok" && h.checked.source ? <CheckedLine checked={h.checked} /> : h.checked.message}
        </div>
      )}
    </>
  );
}

function HomeLinks({ home: h, attr }: { home: FoundHome; attr: "data-finder-analyze" | "data-finder-card-analyze" }) {
  const l = h.listing;
  return (
    <>
      <a href={zillowHref(l.address)} target="_blank" rel="noreferrer noopener" className="underline" onClick={(e) => e.stopPropagation()}>
        Zillow
      </a>
      {/* A new tab, so that the search stays where it is. The click leaves the note that starts the analysis there (lib/finder/hand-off.ts). */}
      <a
        href={analyzeHref({ address: l.address, price: l.price, beds: l.beds, baths: l.baths, sqft: l.sqft })}
        target="_blank"
        rel="noopener"
        className="ml-3 font-medium underline"
        onClick={(e) => {
          e.stopPropagation();
          noteFullAnalysis(browserNotes(), l.address, Date.now());
        }}
        // The middle button opens a tab too; a right click (which some browsers also report here) leaves no note.
        onAuxClick={(e) => {
          if (e.button === 1) noteFullAnalysis(browserNotes(), l.address, Date.now());
        }}
        {...{ [attr]: "" }}
      >
        Full analysis
      </a>
    </>
  );
}

function CardFigure({ label, value, note, tone = "" }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className={`font-medium tabular-nums ${tone}`}>
        {value}
        {note && <span className="block text-[11px] font-normal text-ink-500">{note}</span>}
      </dd>
    </div>
  );
}

/** What a closer look was against, as an analysis would say it: the record, how far and how far back the sales were read, whether they were a part, when; and the sales the value was drawn from. */
function CheckedLine({ checked }: { checked: NonNullable<FoundHome["checked"]> }) {
  const search = checked.source!.search;
  const comps = checked.screen?.comps ?? [];
  return (
    <>
      Checked: its own public record, and {search.usable} home{search.usable === 1 ? "" : "s"} sold within {search.radiusMiles} mile{search.radiusMiles === 1 ? "" : "s"} in the last {search.months} months, read {day(search.readAt)}.
      {search.sampled ? " More had sold than RenoFlip reads at once: these are a part." : ""}
      {search.stoppedEarly ? " The search could not be taken wider this time." : ""}
      {comps.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer text-ink-700 underline">The {comps.length} sale{comps.length === 1 ? "" : "s"} the value was drawn from</summary>
          <ul className="mt-1 space-y-0.5 text-ink-600" data-finder-comps>
            {comps.map((c, i) => (
              <li key={i}>
                {c.address ?? "Address not on record"}: {money(c.price)} on {day(c.saleDate)}, {c.distanceMiles} mi away
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
