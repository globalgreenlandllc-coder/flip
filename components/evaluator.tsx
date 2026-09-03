"use client";

import { useCallback, useState } from "react";
import type { Report } from "@/lib/engine/types";

const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

const VERDICT_STYLE: Record<string, string> = {
  GO: "bg-emerald-600 text-white",
  TIGHT: "bg-amber-500 text-black",
  PASS: "bg-red-600 text-white",
};

export function Evaluator({ initial, initialWarning }: { initial: Report | null; initialWarning?: string }) {
  const [askingPrice, setAskingPrice] = useState(749000);
  const [rehab, setRehab] = useState<string>("");
  const [targetProfit, setTargetProfit] = useState(60000);
  const [holdingMonths, setHoldingMonths] = useState(6);
  const [rate, setRate] = useState(11);
  const [report, setReport] = useState<Report | null>(initial);
  const [warning, setWarning] = useState<string | undefined>(initialWarning);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: "synthetic demo property",
          deal: {
            askingPrice,
            rehab: rehab === "" ? undefined : Number(rehab),
            targetProfit,
            holdingMonths,
            financing: { rate: rate / 100, ltc: 0.85, points: 0.02 },
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setReport(json.report);
      setWarning(json.warning);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [askingPrice, rehab, targetProfit, holdingMonths, rate]);

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="mt-8 grid grid-cols-2 gap-4 rounded-xl border border-neutral-200 p-5 md:grid-cols-5">
        <Field label="Asking price" value={askingPrice} onChange={(v) => setAskingPrice(Number(v))} />
        <Field label="Rehab (blank = estimate)" value={rehab} onChange={setRehab} placeholder="auto" />
        <Field label="Target profit" value={targetProfit} onChange={(v) => setTargetProfit(Number(v))} />
        <Field label="Hold (months)" value={holdingMonths} onChange={(v) => setHoldingMonths(Number(v))} />
        <Field label="Loan rate %" value={rate} onChange={(v) => setRate(Number(v))} />
        <button
          type="submit"
          disabled={busy}
          className="col-span-2 rounded-lg bg-black px-4 py-2 font-medium text-white disabled:opacity-50 md:col-span-5"
        >
          {busy ? "Evaluating…" : "Evaluate"}
        </button>
      </form>

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {warning && <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{warning}</p>}

      {report && <ReportView report={report} />}
    </div>
  );
}

function Field(props: { label: string; value: string | number; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-600">{props.label}</span>
      <input
        className="rounded-md border border-neutral-300 px-2 py-1.5"
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        inputMode="numeric"
      />
    </label>
  );
}

export function ReportView({ report }: { report: Report }) {
  const { subject, arv, deal, riskFlags } = report;
  return (
    <section className="mt-8 space-y-8">
      <div className="flex flex-wrap items-center gap-4">
        <span className={`rounded-lg px-4 py-2 text-2xl font-bold ${VERDICT_STYLE[deal.verdict]}`}>{deal.verdict}</span>
        <p className="max-w-2xl text-lg">{deal.decidingFactor}</p>
      </div>

      <p className="text-sm text-neutral-500">
        Subject: {subject.sqft.toLocaleString()} sqft, {subject.beds} bd / {subject.baths} ba, built {subject.yearBuilt}, {subject.condition}, {subject.submarket}
      </p>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="ARV" value={money(arv.point)} sub={`${money(arv.low)} – ${money(arv.high)} · ${arv.confidence}${arv.cappedByCeiling ? " · capped" : ""}`} />
        <Stat label="Max offer" value={money(deal.maxAllowableOffer)} sub={`asking is ${money(Math.abs(deal.askingVsMao))} ${deal.askingVsMao > 0 ? "above" : "below"}`} />
        <Stat label="Profit at asking" value={money(deal.profit)} sub={Number.isNaN(deal.roi) ? "" : `${Math.round(deal.roi * 100)}% on cash`} />
        <Stat label="Ceiling" value={arv.ceiling ? money(arv.ceiling.value) : "unknown"} sub={arv.ceiling ? `${money(arv.ceiling.pricePerSqft)}/sqft · n=${arv.ceiling.sampleSize}` : "thin submarket sample"} />
      </div>

      <Block title="Why">
        <ol className="list-decimal space-y-1 pl-5">
          {report.narrative.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      </Block>

      <Block title={`Comps (${arv.comps.length}) within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-neutral-500">
              <tr>
                <th className="py-1 pr-3">Sold</th>
                <th className="py-1 pr-3">Adjusted</th>
                <th className="py-1 pr-3">Sqft</th>
                <th className="py-1 pr-3">Condition</th>
                <th className="py-1 pr-3">Dist</th>
                <th className="py-1 pr-3">Age</th>
                <th className="py-1 pr-3">Gross adj</th>
                <th className="py-1 pr-3">Weight</th>
                <th className="py-1">Adjustments</th>
              </tr>
            </thead>
            <tbody>
              {arv.comps.map((c) => (
                <tr key={c.sale.id} className="border-t border-neutral-100 align-top">
                  <td className="py-1 pr-3">{money(c.sale.price)}</td>
                  <td className="py-1 pr-3 font-medium">{money(c.adjustedPrice)}</td>
                  <td className="py-1 pr-3">{c.sale.sqft}</td>
                  <td className="py-1 pr-3">{c.sale.condition}</td>
                  <td className="py-1 pr-3">{c.distanceMiles.toFixed(2)} mi</td>
                  <td className="py-1 pr-3">{c.monthsAgo.toFixed(1)} mo</td>
                  <td className="py-1 pr-3">{pct(c.grossAdjustmentPct)}</td>
                  <td className="py-1 pr-3">{c.weight.toFixed(3)}</td>
                  <td className="py-1 text-neutral-500">
                    {c.adjustments.map((a) => `${a.factor} ${a.amount >= 0 ? "+" : "−"}${money(Math.abs(a.amount))}`).join(", ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <div className="grid gap-8 md:grid-cols-2">
        <Block title="Deal">
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
        </Block>

        <Block title="Sensitivity: profit">
          <table className="w-full text-sm">
            <thead className="text-neutral-500">
              <tr>
                <th className="py-1 text-left">ARV \ rehab</th>
                <th className="py-1 text-right">+0%</th>
                <th className="py-1 text-right">+10%</th>
                <th className="py-1 text-right">+20%</th>
              </tr>
            </thead>
            <tbody>
              {[0, -0.05, -0.1].map((a) => (
                <tr key={a} className="border-t border-neutral-100">
                  <td className="py-1">{a * 100}%</td>
                  {deal.sensitivity
                    .filter((s) => s.arvDeltaPct === a)
                    .map((s) => (
                      <td key={s.rehabDeltaPct} className={`py-1 text-right ${s.profit < 0 ? "text-red-600" : ""}`}>
                        {money(s.profit)}
                      </td>
                    ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Block>
      </div>

      {riskFlags.length > 0 && (
        <Block title="Risk flags">
          <ul className="space-y-1">
            {riskFlags.map((f) => (
              <li key={f.code}>
                <span className="mr-2 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-xs">{f.code}</span>
                {f.message}
              </li>
            ))}
          </ul>
        </Block>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 p-4">
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-neutral-500">{sub}</div>}
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-2 text-lg font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <tr className={`border-t border-neutral-100 ${bold ? "font-semibold" : ""}`}>
      <td className="py-1">{k}</td>
      <td className="py-1 text-right">{v}</td>
    </tr>
  );
}
