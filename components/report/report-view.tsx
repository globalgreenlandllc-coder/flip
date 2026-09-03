import type { Report } from "@/lib/engine/types";
import { VerdictBadge } from "@/components/ui/verdict";

export const money = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
export const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tracking-tight ${tone === "bad" ? "text-pass" : tone === "good" ? "text-go" : ""}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-500">{sub}</div>}
    </div>
  );
}

export function Block({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <h2 className="text-base font-semibold">{title}</h2>
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

/** The full report body. The verdict row can be hidden when the caller renders its own header. */
export function ReportView({ report, hideVerdict = false }: { report: Report; hideVerdict?: boolean }) {
  const { subject, arv, deal, riskFlags } = report;
  return (
    <section className="space-y-8">
      {!hideVerdict && (
        <div className="flex flex-wrap items-center gap-4">
          <VerdictBadge verdict={deal.verdict} size="lg" />
          <p className="max-w-2xl text-lg">{deal.decidingFactor}</p>
        </div>
      )}

      <p className="text-sm text-ink-500">
        Subject: {subject.sqft.toLocaleString()} sqft · {subject.beds} bd / {subject.baths} ba · built {subject.yearBuilt} · {subject.condition} · {subject.submarket}
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="ARV" value={money(arv.point)} sub={`${money(arv.low)} – ${money(arv.high)} · ${arv.confidence}${arv.cappedByCeiling ? " · capped" : ""}`} />
        <Stat label="Max offer" value={money(deal.maxAllowableOffer)} sub={`asking is ${money(Math.abs(deal.askingVsMao))} ${deal.askingVsMao > 0 ? "above" : "below"}`} tone={deal.askingVsMao > 0 ? "bad" : "good"} />
        <Stat label="Profit at asking" value={money(deal.profit)} sub={Number.isNaN(deal.roi) ? undefined : `${Math.round(deal.roi * 100)}% on cash`} tone={deal.profit < 0 ? "bad" : undefined} />
        <Stat label="Ceiling" value={arv.ceiling ? money(arv.ceiling.value) : "unknown"} sub={arv.ceiling ? `${money(arv.ceiling.pricePerSqft)}/sqft · n=${arv.ceiling.sampleSize}` : "thin submarket sample"} />
      </div>

      <Block title="Why">
        <ol className="list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed">
          {report.narrative.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ol>
      </Block>

      <Block title={`Comps (${arv.comps.length}) within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo`}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-ink-100/60 text-left text-xs uppercase tracking-wide text-ink-500">
              <tr>
                {["Sold", "Adjusted", "Sqft", "Condition", "Dist", "Age", "Gross adj", "Weight", "Adjustments"].map((h) => (
                  <th key={h} className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {arv.comps.map((c) => (
                <tr key={c.sale.id} className="border-t border-ink-100 align-top">
                  <td className="px-3 py-2 tabular-nums">{money(c.sale.price)}</td>
                  <td className="px-3 py-2 font-medium tabular-nums">{money(c.adjustedPrice)}</td>
                  <td className="px-3 py-2">{c.sale.sqft}</td>
                  <td className="px-3 py-2">{c.sale.condition}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.distanceMiles.toFixed(2)} mi</td>
                  <td className="px-3 py-2 whitespace-nowrap">{c.monthsAgo.toFixed(1)} mo</td>
                  <td className="px-3 py-2">{pct(c.grossAdjustmentPct)}</td>
                  <td className="px-3 py-2">{c.weight.toFixed(3)}</td>
                  <td className="px-3 py-2 text-ink-500">{c.adjustments.map((a) => `${a.factor} ${a.amount >= 0 ? "+" : "−"}${money(Math.abs(a.amount))}`).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>

      <div className="grid gap-8 md:grid-cols-2">
        <Block title="Deal">
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

        <Block title="Sensitivity: profit">
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
                <span>{f.message}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </section>
  );
}
