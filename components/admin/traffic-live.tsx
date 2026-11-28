"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MapTiles } from "@/lib/map-tiles";
import type { ListRow, TrafficData, TrafficQuery } from "@/lib/admin/traffic-server";
import { AD_RING, RAIL_SPANS, SPANS, STAGES, STAGE_COLOR, STAGE_LABEL, signupStep, type Stage } from "@/lib/admin/traffic-shared";
import { AREA_TIME_ZONE } from "@/lib/area";
import { TrafficMap } from "./traffic-map";

const LIVE_MS = 15_000;
const SLOW_MS = 45_000;

const n = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("en-US") : "—");
const plural = (v: number, one: string, many: string) => `${v.toLocaleString("en-US")} ${v === 1 ? one : many}`;
/** "3:31 PM", on the area's clock (the same on the server's first paint and in the browser). */
const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: AREA_TIME_ZONE });
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: AREA_TIME_ZONE });
/** A time as the list shows it: "3:31 PM" today, "Nov 26, 3:31 PM" on another day (both on the area's clock, against the data's own day). */
const when = (iso: string, at: string) => (shortDate(iso) === shortDate(at) ? clock(iso) : `${shortDate(iso)}, ${clock(iso)}`);
/** "7 min ago", measured from the data's own time, so the first paint and the browser agree. */
function ago(iso: string, at: string): string {
  const min = Math.max(0, Math.round((new Date(at).getTime() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60 ? `${min % 60} min ` : ""}ago`;
}
const deviceLine = (r: { device: string | null; browser: string | null }) => [r.device ? r.device[0].toUpperCase() + r.device.slice(1) : null, r.browser].filter(Boolean).join(" · ") || "Device not known";

/** Two short tones, made in the browser: no sound file is fetched. Only after the owner's own click armed it. */
function chime(ctx: AudioContext) {
  const t = ctx.currentTime;
  [880, 1318.5].forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = f;
    const s = t + i * 0.15;
    g.gain.setValueAtTime(0.0001, s);
    g.gain.exponentialRampToValueAtTime(0.22, s + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, s + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(s);
    o.stop(s + 0.55);
  });
}

function Toggle({ on, onClick, children, hook }: { on: boolean; onClick: () => void; children: React.ReactNode; hook: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex min-h-9 items-center gap-2 rounded-[8px] border px-3 text-[13px] font-semibold ${on ? "border-ink-950 bg-ink-950 text-white" : "border-ink-200 bg-white text-ink-700 hover:border-ink-400"}`}
      data-traffic-toggle={hook}
    >
      <span className={`h-3.5 w-3.5 rounded-[4px] border ${on ? "border-orange bg-orange" : "border-ink-400 bg-white"}`} aria-hidden />
      {children}
    </button>
  );
}

function Tile({ label, value, note, dark = false, hook }: { label: string; value: string; note: string; dark?: boolean; hook: string }) {
  return (
    <div className={`flex min-w-0 flex-col gap-2.5 px-4 py-5 sm:px-6 ${dark ? "bg-ink-950 text-white" : "bg-[#f6f7f3]"}`} data-traffic-tile={hook}>
      <span className={`text-[13px] font-semibold ${dark ? "text-[#c3ccd0]" : "text-ink-700"}`}>{label}</span>
      <p className={`tabular text-[30px] font-bold leading-none tracking-[-0.05em] sm:text-[38px] ${dark ? "text-white" : "text-ink-950"}`} data-traffic-value>
        {value}
      </p>
      <p className={`text-xs leading-relaxed ${dark ? "text-[#c3ccd0]" : "text-ink-500"}`}>{note}</p>
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, hook }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void; hook: string }) {
  return (
    <div role="group" aria-label={label} className="flex w-max rounded-[10px] bg-[#e9ebe5] p-1 text-[13px]" data-traffic-segment={hook}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={o.key === value}
          onClick={() => onChange(o.key)}
          className={`whitespace-nowrap rounded-[7px] px-3 py-1.5 ${o.key === value ? "bg-ink-950 font-bold text-white" : "font-medium text-ink-700 hover:text-ink-950"}`}
          data-option={o.key}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Dot = ({ stage }: { stage: Stage }) => <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: STAGE_COLOR[stage] }} aria-hidden />;

function Row({ row, at, picked, onPick }: { row: ListRow; at: string; picked: boolean; onPick: () => void }) {
  const who = row.name || row.email;
  const headline = row.stage === "signed-up" && who ? `Signed up → ${row.name ?? row.email}` : who ? `${row.stageLabel} · ${row.name ?? row.email}` : `${row.stageLabel} · a visitor`;
  return (
    <li className={`border-l-4 ${picked ? "bg-[#fff6f1]" : "bg-white"}`} style={{ borderLeftColor: STAGE_COLOR[row.stage] }} data-traffic-row={row.stage} data-visitor={row.visitor} data-picked={picked ? "true" : "false"}>
      <button type="button" onClick={onPick} className="grid w-full min-w-0 gap-3 px-4 py-4 text-left sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] sm:px-5" aria-label={`${headline}: show on the map`}>
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2 text-[15px] font-bold tracking-tight text-ink-950">
            <Dot stage={row.stage} />
            <span className="min-w-0 break-words" data-row-headline>{headline}</span>
            {row.you && <span className="rounded bg-[#fff1ea] px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-[#b9411d]">You</span>}
          </p>
          {row.email && row.name && <p className="mt-0.5 break-all text-xs text-ink-500" data-row-email>{row.email}</p>}
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-700">
            <span className="font-semibold">From {row.source.label}</span>
            {row.source.ad && (
              <span className="rounded border px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wider" style={{ borderColor: AD_RING, color: "#5b21b6" }} data-row-ad>
                Ad
              </span>
            )}
            {row.source.campaign && <span className="break-all text-ink-500">“{row.source.campaign}”</span>}
          </p>
        </div>
        <div className="min-w-0 text-xs leading-relaxed text-ink-700">
          <p className="font-semibold text-ink-950" data-row-when>
            {row.onSiteNow ? "On the site now" : `Left ${ago(row.lastAt, at)}`} · since {when(row.firstAt, at)}
          </p>
          <p>{deviceLine(row)}</p>
          <p>{row.place}</p>
        </div>
        <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-700 sm:col-span-2" aria-label={`${plural(row.pageCount, "page", "pages")} in order`} data-row-pages={row.pageCount}>
          {row.pages.slice(-12).map((p, i) => (
            <li key={`${p.at}-${i}`} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-ink-300" aria-hidden>→</span>}
              <span className="rounded-[6px] bg-[#f1f3ee] px-2 py-0.5">
                {p.name} <span className="text-ink-500">{when(p.at, at)}</span>
              </span>
            </li>
          ))}
          {row.pageCount > 12 && <li className="text-ink-500">(the last 12 of {row.pageCount})</li>}
        </ol>
      </button>
    </li>
  );
}

/**
 * The live Traffic view: refreshed every 15 seconds while the tab is in front (45 with Live off; also in the
 * background while Sound is on), straight away when the tab comes back. A refresh that fails keeps the last numbers
 * and says so.
 */
export function TrafficLive({ initial, tiles }: { initial: TrafficData | null; tiles: MapTiles | null }) {
  const [query, setQuery] = useState<TrafficQuery>(initial?.query ?? { span: "1d", audience: "everyone", source: null, mine: false, rail: "today" });
  const [data, setData] = useState<TrafficData | null>(initial);
  const [error, setError] = useState<string | null>(initial ? null : "The traffic could not be read just now. It will be tried again in a moment.");
  const [live, setLive] = useState(true);
  const [sound, setSound] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [chimes, setChimes] = useState(0);
  const audio = useRef<AudioContext | null>(null);
  const soundOn = useRef(false);
  const seen = useRef<Set<string> | null>(initial?.signupIds ? new Set(initial.signupIds) : null);
  const firstPaint = useRef(Boolean(initial));
  // Only the newest request counts: a slow answer for an earlier choice (a month, say) is stopped or dropped.
  const inFlight = useRef<AbortController | null>(null);
  const asked = useRef(0);

  // `byOwner`: a choice or the Refresh button stops a slower answer for the old choice. A timed poll does not: it is
  // skipped while an answer is still coming, so a slow answer (over 15 s) is never cut off again and again.
  const refresh = useCallback(async (q: TrafficQuery, byOwner = false) => {
    if (inFlight.current && !byOwner) return;
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    const mine = ++asked.current;
    setBusy(true);
    try {
      const params = new URLSearchParams({ span: q.span, audience: q.audience, rail: q.rail, mine: q.mine ? "1" : "0" });
      if (q.source) params.set("source", q.source);
      const res = await fetch(`/api/admin/traffic?${params.toString()}`, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error(String(res.status));
      const next = (await res.json()) as TrafficData;
      if (mine !== asked.current) return;
      const step = signupStep(seen.current, next.signupIds);
      seen.current = step.seen;
      if (step.chime.length && soundOn.current && audio.current) {
        chime(audio.current);
        setChimes((c) => c + step.chime.length);
      }
      setData(next);
      setError(next.stale ? "This refresh failed; the numbers shown are from the last good read." : null);
    } catch {
      if (mine !== asked.current || controller.signal.aborted) return;
      setError("The traffic could not be refreshed just now; the numbers shown are from the last good read.");
    } finally {
      if (mine === asked.current) {
        setBusy(false);
        inFlight.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const every = live ? LIVE_MS : SLOW_MS;
    const tick = async (now: boolean, byOwner = false) => {
      if (stopped) return;
      if (now && (document.visibilityState === "visible" || soundOn.current)) await refresh(query, byOwner);
      if (!stopped) timer = setTimeout(() => void tick(true), every);
    };
    // The server's first paint is fresh: the first refresh waits its turn. A changed choice refreshes at once.
    void tick(!firstPaint.current, !firstPaint.current);
    firstPaint.current = false;
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      void tick(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [query, live, refresh]);

  const toggleSound = () => {
    const next = !sound;
    if (next) {
      // The owner's click is what lets a page play sound: the tones are made from here on.
      try {
        const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Ctx) {
          audio.current ??= new Ctx();
          void audio.current.resume();
          setArmed(true);
        }
      } catch {
        // No sound in this browser.
      }
    }
    soundOn.current = next;
    setSound(next);
  };

  const set = (patch: Partial<TrafficQuery>) => setQuery((q) => ({ ...q, ...patch }));
  const t = data?.tiles ?? null;
  const vsYesterday = t
    ? t.sameTimeYesterday > 0
      ? (() => {
          const pct = Math.round(((t.visitorsToday - t.sameTimeYesterday) / t.sameTimeYesterday) * 100);
          return pct === 0 ? "The same as this time yesterday." : `${Math.abs(pct)}% ${pct > 0 ? "ahead of" : "behind"} this time yesterday (${n(t.sameTimeYesterday)}).`;
        })()
      : "None by this time yesterday."
    : "The visits could not be read.";

  return (
    <div className="flex min-w-0 flex-col gap-6" data-traffic-live data-chimes={chimes} data-sound-armed={armed ? "true" : "false"} data-updated={data?.at ?? ""}>
      {/* Live now */}
      <section className="min-w-0 overflow-hidden rounded-[14px] border border-ink-200 bg-white" aria-labelledby="traffic-live">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-ink-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="traffic-live" className="flex items-center gap-2.5 text-[20px] font-bold tracking-[-0.04em] text-ink-950">
              <span className={`h-2.5 w-2.5 rounded-full ${live ? "rf-live-dot bg-orange" : "bg-ink-300"}`} aria-hidden />
              Live now
            </h2>
            <p className="mt-1 text-xs text-ink-500" data-traffic-status>
              On the site = a page in the last 5 minutes · refreshes every {live ? "15" : "45"} s{sound ? ", in the background too" : ""}
              {data ? ` · updated ${clock(data.at)}` : ""}
              {busy ? " · refreshing…" : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Toggle on={live} onClick={() => setLive((v) => !v)} hook="live">
              Live · 15 s
            </Toggle>
            <Toggle on={sound} onClick={toggleSound} hook="sound">
              Sound on a sign-up
            </Toggle>
            <Toggle on={query.mine} onClick={() => set({ mine: !query.mine })} hook="mine">
              Show mine
            </Toggle>
            <button type="button" onClick={() => void refresh(query, true)} className="inline-flex min-h-9 items-center rounded-[8px] border border-ink-200 bg-white px-3 text-[13px] font-semibold text-ink-700 hover:border-ink-400" data-traffic-refresh>
              Refresh
            </button>
          </div>
        </div>
        {error && (
          <p className="border-b border-amber-200 bg-amber-50 px-5 py-2.5 text-xs text-amber-900 sm:px-6" data-traffic-error>
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-px bg-ink-200 lg:grid-cols-4">
          <Tile dark hook="now" label="On the site now" value={n(t?.onSiteNow)} note={t ? `${plural(data?.lastHalfHour ?? 0, "visitor", "visitors")} in the last 30 minutes.` : "The visits could not be read."} />
          <Tile hook="today" label="Visitors today" value={n(t?.visitorsToday)} note={vsYesterday} />
          <Tile hook="signed" label="Signed up today" value={n(t?.signedUpToday)} note={t && t.signedUpToday === null ? "The sign-in service could not be read." : "New accounts since midnight, Pacific."} />
          <Tile hook="since" label="Visitors since counting began" value={n(t?.visitorsSince)} note={t?.since ? `Since ${shortDate(t.since)}. Each visitor counted once a day.` : "No visits counted yet."} />
        </div>
        {data?.sentence && (
          <p className="border-t border-ink-200 px-5 py-4 text-[15px] leading-relaxed text-ink-900 sm:px-6" data-traffic-sentence>
            {data.sentence}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-ink-200 bg-[#f6f7f3] px-5 py-3 text-[13px] sm:px-6" data-traffic-stages>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-ink-500">Last 30 min · {n(data?.lastHalfHour)} {data?.lastHalfHour === 1 ? "visitor" : "visitors"} · visits by stage</span>
          {STAGES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5 text-ink-700" data-stage-count={s}>
              <Dot stage={s} />
              {STAGE_LABEL[s].toLowerCase()} <b className="tabular text-ink-950">{n(data?.stages[s])}</b>
            </span>
          ))}
        </div>
      </section>

      {/* Where they came from */}
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="traffic-sources">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="traffic-sources" className="text-[22px] font-bold tracking-[-0.04em] text-ink-950">Where they came from</h2>
          <p className="text-xs text-ink-500">The last 30 minutes. Press a card to see only its visitors on the map and in the list.</p>
        </div>
        {data && data.cards.length === 0 && <p className="text-sm text-ink-500">Nobody in the last 30 minutes.</p>}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data?.cards.map((c) => {
            const on = query.source === c.platform;
            return (
              <button
                key={c.platform}
                type="button"
                aria-pressed={on}
                onClick={() => set({ source: on ? null : c.platform })}
                className={`flex min-w-0 flex-col gap-2 rounded-[14px] border bg-white p-4 text-left ${on ? "border-ink-950 ring-2 ring-orange" : "border-ink-200 hover:border-ink-400"}`}
                data-source-card={c.platform}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-bold text-ink-950">{c.label}</span>
                  <span className="tabular text-[26px] font-bold leading-none tracking-[-0.05em] text-ink-950">{c.total}</span>
                </span>
                <span className="text-xs text-ink-700">
                  {c.ads} from ads · {c.organic} not from ads
                </span>
                <span className="text-xs text-ink-700">
                  {c.signingUp} signing up · {c.signedUp} signed up · {c.today} today
                </span>
                {c.campaigns.length > 0 && <span className="truncate text-xs text-ink-500">Campaign: {c.campaigns.join(", ")}</span>}
              </button>
            );
          })}
        </div>
        {data && data.nothingYet.length > 0 && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-ink-500" data-traffic-nothing-yet>
            Nothing yet from
            {data.nothingYet.map((p) => (
              <span key={p.platform} className="rounded-[6px] border border-ink-200 bg-white px-2 py-1 font-semibold text-ink-700">
                {p.label}
              </span>
            ))}
            — an ad tagged with utm_source names itself here.
          </p>
        )}
        {query.source && (
          <button type="button" onClick={() => set({ source: null })} className="w-fit text-xs font-semibold text-[#b9411d] underline" data-traffic-clear-source>
            Show every source again
          </button>
        )}
      </section>

      {/* The map */}
      <section className="flex min-w-0 flex-col gap-3" aria-labelledby="traffic-map">
        <h2 id="traffic-map" className="text-[22px] font-bold tracking-[-0.04em] text-ink-950">On the map</h2>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Segmented
            label="Who is shown"
            hook="audience"
            value={query.audience}
            options={[
              { key: "everyone", label: "Everyone" },
              { key: "prospects", label: "Prospects" },
            ]}
            onChange={(v) => set({ audience: v })}
          />
          <div className="min-w-0 max-w-full overflow-x-auto">
            <Segmented label="How far back" hook="span" value={query.span} options={SPANS.map((s) => ({ key: s.key, label: s.label }))} onChange={(v) => set({ span: v })} />
          </div>
        </div>
        <p className="text-xs text-ink-700" data-traffic-map-count>
          {data ? `${plural(data.map.count, "visitor", "visitors")} in this time${data.map.cut ? `; the newest ${data.map.pins.length} are on the map` : ""}. Prospects are everyone who is not a member using the app.` : ""}
        </p>
        {data?.rowsCut && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" data-traffic-rows-cut>
            So many pages in this time that only the newest 100,000 were read: older visits are not on the map. A shorter time shows them all.
          </p>
        )}
        <TrafficMap pins={data?.map.pins ?? []} tiles={tiles} selected={selected} onSelect={setSelected} />
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-700" data-traffic-legend>
          {STAGES.map((s) => (
            <span key={s} className="inline-flex items-center gap-1.5">
              <Dot stage={s} /> {STAGE_LABEL[s]}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full border-[3px] bg-white" style={{ borderColor: AD_RING }} aria-hidden /> Ring: from an ad
          </span>
          <span>Soft halo: on the site now</span>
        </p>
        <p className="text-xs text-ink-500">The place is the city of the visitor&apos;s internet address, as Vercel reads it: close, not exact.</p>
      </section>

      {/* Who is on the site, and the sign-ups */}
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 overflow-hidden rounded-[14px] border border-ink-200 bg-white" aria-labelledby="traffic-who" data-traffic-list>
          <div className="border-b border-ink-200 px-5 py-4">
            <h2 id="traffic-who" className="text-[20px] font-bold tracking-[-0.04em] text-ink-950">Who is on the site</h2>
            <p className="mt-1 text-xs text-ink-500">
              {data ? `${plural(data.list.length, "visitor", "visitors")} in the last 30 minutes` : "—"} · newest move first · press one to see it on the map. Names show only for people signed in.
            </p>
          </div>
          {!data || data.list.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-500">{data ? "Nobody in the last 30 minutes." : "The visits could not be read."}</p>
          ) : (
            <ol className="divide-y divide-ink-100">
              {data.list.map((r) => (
                <Row key={r.visitor} row={r} at={data.at} picked={selected === r.visitor} onPick={() => setSelected(r.visitor)} />
              ))}
            </ol>
          )}
        </section>

        <aside className="min-w-0 overflow-hidden rounded-[14px] border border-ink-200 bg-white" aria-labelledby="traffic-rail" data-traffic-rail>
          <div className="flex flex-col gap-3 border-b border-ink-200 px-5 py-4">
            <h2 id="traffic-rail" className="text-[20px] font-bold tracking-[-0.04em] text-ink-950">
              Signed up <span className="tabular text-ink-500">{data?.rail ? data.rail.people.length : ""}</span>
            </h2>
            <Segmented label="Signed up in" hook="rail" value={query.rail} options={RAIL_SPANS.map((r) => ({ key: r.key, label: r.label }))} onChange={(v) => set({ rail: v })} />
          </div>
          {!data?.rail ? (
            <p className="px-5 py-6 text-sm text-amber-900">The sign-ups could not be read just now.</p>
          ) : data.rail.people.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-500">Nobody signed up in this time. Your own account is left out.</p>
          ) : (
            <ol className="divide-y divide-ink-100">
              {data.rail.people.map((p) => (
                <li key={p.id} className="px-5 py-3.5" data-rail-person>
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-bold text-ink-950">{p.name || p.email || "No name"}</span>
                    <span className="shrink-0 text-xs text-ink-500">
                      {shortDate(p.createdAt)} {clock(p.createdAt)}
                    </span>
                  </p>
                  {p.email && p.name && <p className="break-all text-xs text-ink-500">{p.email}</p>}
                  <p className="mt-1 text-xs text-ink-700" data-rail-from>
                    {p.probablyFrom ? `Probably from ${p.probablyFrom}` : "Where from: not seen"}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
