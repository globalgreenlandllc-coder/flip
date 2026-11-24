"use client";

import { useCallback, useState } from "react";
import type { Report } from "@/lib/engine/types";
import { ReportView } from "@/components/report/report-view";
import { VerdictBadge } from "@/components/ui/verdict";
import { DemoBanner } from "@/components/ui/demo";
import { isDemoProvider } from "@/lib/data/demo";
import { SaveDealButton } from "@/components/app/save-deal-button";

function Field(props: { id: string; label: string; value: string | number; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <label className="label" htmlFor={props.id}>{props.label}</label>
      <input id={props.id} className="input" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} inputMode="numeric" />
    </div>
  );
}

/** Quick numbers: no photos, condition-tier rehab, editable assumptions. */
export function Evaluator({ initial, initialProvider }: { initial: Report | null; initialProvider: string }) {
  const [askingPrice, setAskingPrice] = useState(749000);
  const [rehab, setRehab] = useState<string>("");
  const [targetProfit, setTargetProfit] = useState(60000);
  const [holdingMonths, setHoldingMonths] = useState(6);
  const [rate, setRate] = useState(11);
  const [report, setReport] = useState<Report | null>(initial);
  // Where the numbers on screen came from; "synthetic" is made-up data, and everything below is marked DEMO.
  const [provider, setProvider] = useState(initialProvider);
  const demo = isDemoProvider(provider);
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
      setProvider(json.demo === false && typeof json.provider === "string" ? json.provider : "synthetic");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [askingPrice, rehab, targetProfit, holdingMonths, rate]);

  return (
    <div className="space-y-8">
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="card grid grid-cols-2 gap-4 p-5 sm:p-6 md:grid-cols-6">
        <Field id="asking" label="Asking price" value={askingPrice} onChange={(v) => setAskingPrice(Number(v))} />
        <Field id="rehab" label="Rehab" value={rehab} onChange={setRehab} placeholder="auto" />
        <Field id="target" label="Target profit" value={targetProfit} onChange={(v) => setTargetProfit(Number(v))} />
        <Field id="hold" label="Hold (months)" value={holdingMonths} onChange={(v) => setHoldingMonths(Number(v))} />
        <Field id="rate" label="Loan rate %" value={rate} onChange={(v) => setRate(Number(v))} />
        <div className="flex items-end">
          <button type="submit" disabled={busy} className="btn-primary w-full">{busy ? "Evaluating…" : "Evaluate"}</button>
        </div>
      </form>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {report && demo && <DemoBanner kind="quick" />}

      {report && (
        <section className="space-y-8">
          <div className="card flex flex-wrap items-center gap-4 p-5">
            <VerdictBadge verdict={report.deal.verdict} size="lg" demo={demo} />
            <p className="flex-1 basis-80 text-lg leading-snug">{report.deal.decidingFactor}</p>
            <SaveDealButton payload={{ report, provider }} />
          </div>
          <ReportView report={report} hideVerdict demo={demo} />
        </section>
      )}
    </div>
  );
}
