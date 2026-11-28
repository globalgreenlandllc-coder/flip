"use client";

import { useCallback, useState } from "react";
import type { Report } from "@/lib/engine/types";
import { isDemoProvider } from "@/lib/data/demo";
import { SaveDealButton } from "@/components/app/save-deal-button";
import { ResultView } from "@/components/report/result-view";

function Field(props: { id: string; label: string; value: string | number; onChange: (v: string) => void; placeholder?: string; prefix?: string; suffix?: string }) {
  return (
    <div>
      <label className="label" htmlFor={props.id}>
        {props.label}
      </label>
      <div className="flex items-center rounded-[10px] border border-[#dde0dc] bg-white focus-within:border-ink-950 focus-within:shadow-[0_0_0_3px_rgb(16_24_32_/_0.1)]">
        {props.prefix && <span className="pl-3 text-sm text-ink-400">{props.prefix}</span>}
        <input id={props.id} className="w-full bg-transparent px-3 py-2.5 text-[15px] font-semibold text-ink-900 outline-none placeholder:font-normal placeholder:text-[#98a0a3]" value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} inputMode="numeric" />
        {props.suffix && <span className="pr-3 text-sm text-ink-400">{props.suffix}</span>}
      </div>
    </div>
  );
}

/** Quick numbers: no photos, a renovation priced from the condition on record, assumptions to change. */
export function Evaluator({ initial, initialProvider }: { initial: Report | null; initialProvider: string }) {
  const [askingPrice, setAskingPrice] = useState(749000);
  const [rehab, setRehab] = useState<string>("");
  const [targetProfit, setTargetProfit] = useState(60000);
  const [holdingMonths, setHoldingMonths] = useState(6);
  const [rate, setRate] = useState(11);
  const [report, setReport] = useState<Report | null>(initial);
  // The renovation figure the shown result was run with (null: the condition's estimate), so its plan tab says so.
  const [ranRehab, setRanRehab] = useState<number | null>(null);
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
      setRanRehab(rehab === "" ? null : Number(rehab));
      setProvider(json.demo === false && typeof json.provider === "string" ? json.provider : "synthetic");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [askingPrice, rehab, targetProfit, holdingMonths, rate]);

  return (
    <div className="space-y-8">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
        className="card grid grid-cols-2 gap-4 p-5 shadow-[0_8px_30px_#10182008] sm:p-6 md:grid-cols-6"
        data-quick-form
      >
        <Field id="asking" label="Purchase price" prefix="$" value={askingPrice} onChange={(v) => setAskingPrice(Number(v))} />
        <Field id="rehab" label="Renovation" prefix="$" value={rehab} onChange={setRehab} placeholder="auto" />
        <Field id="target" label="Target profit" prefix="$" value={targetProfit} onChange={(v) => setTargetProfit(Number(v))} />
        <Field id="hold" label="Project length" suffix="mo" value={holdingMonths} onChange={(v) => setHoldingMonths(Number(v))} />
        <Field id="rate" label="Loan interest" suffix="%" value={rate} onChange={(v) => setRate(Number(v))} />
        <div className="flex items-end">
          <button type="submit" disabled={busy} className="btn-accent w-full">
            {busy ? "Running…" : "Run the numbers"}
          </button>
        </div>
      </form>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {report && (
        <ResultView
          report={report}
          demo={demo}
          untested={false}
          conditionFrom="record"
          title="The demo house"
          subtitle="A made-up house in a made-up area: the numbers show how the deal math works, not what a real house is worth."
          rehabTyped={ranRehab}
          priceWhat="The price you entered"
          targetSet
          actions={<SaveDealButton payload={{ report, provider }} />}
        />
      )}
    </div>
  );
}
