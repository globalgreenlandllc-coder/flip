/**
 * End-to-end demo on synthetic data:  npm run demo [askingPrice]
 */
import { DEFAULT_DEAL_TERMS, DEFAULT_MARKET_CONFIG, evaluate, fmt } from "../lib/engine/index.ts";
import { generateMarketData } from "../lib/engine/synthetic.ts";

const askingPrice = Number(process.argv[2] ?? 749_000);
const asOf = "2026-09-01";
const { subject, sales } = generateMarketData({ seed: 42, count: 600, asOf });

const report = evaluate({
  subject,
  sales,
  asOf,
  config: DEFAULT_MARKET_CONFIG,
  deal: { ...DEFAULT_DEAL_TERMS, askingPrice },
});

const { arv, deal } = report;
const line = (s = "") => console.log(s);

line(`SUBJECT  ${subject.sqft} sqft, ${subject.beds}bd/${subject.baths}ba, built ${subject.yearBuilt}, ${subject.condition}, ${subject.submarket}`);
line();
line(`VERDICT: ${deal.verdict}`);
line(`  ${deal.decidingFactor}`);
line();
line(`ARV:        $${fmt(arv.point)}${arv.cappedByCeiling ? "  (capped by ceiling)" : ""}`);
line(`Range:      $${fmt(arv.low)} — $${fmt(arv.high)}  (spread ${(arv.spreadPct * 100).toFixed(1)}%)`);
line(`Confidence: ${arv.confidence}`);
line(`${arv.comps.length} comps within ${arv.criteriaUsed.radiusMiles} mi / ${arv.criteriaUsed.months} mo (±${arv.criteriaUsed.sqftTolerance * 100}% sqft)`);
line();
if (arv.ceiling) {
  line(`NEIGHBORHOOD CEILING`);
  line(`  Top-decile renovated sales in ${subject.submarket} clear $${fmt(arv.ceiling.pricePerSqft)}/sqft (n=${arv.ceiling.sampleSize}).`);
  line(`  For this square footage that caps out at ~$${fmt(arv.ceiling.value)}.`);
  line();
}
line(`COMPS`);
arv.comps.forEach((c, i) => {
  const adj = c.adjustments.map((a) => `${a.factor} ${a.amount >= 0 ? "+" : "-"}$${fmt(Math.abs(a.amount))}`).join(", ");
  line(`  [${i + 1}] $${fmt(c.sale.price)} → $${fmt(c.adjustedPrice)}  ${c.sale.sqft} sqft ${c.sale.condition}, ${c.distanceMiles.toFixed(2)} mi, ${c.monthsAgo.toFixed(1)} mo, gross ${(c.grossAdjustmentPct * 100).toFixed(1)}%, w=${c.weight.toFixed(3)}`);
  line(`      ${adj}`);
});
line();
line(`DEAL`);
line(`  Purchase      $${fmt(deal.purchasePrice)}`);
line(`  Rehab (+res)  $${fmt(deal.rehabWithReserve)}`);
line(`  Holding       $${fmt(deal.holdingCost)}`);
line(`  Financing     $${fmt(deal.financingCost)}`);
line(`  Closing       $${fmt(deal.closingBuy + deal.closingSell)}`);
line(`  All-in        $${fmt(deal.totalCost)}`);
line(`  Profit        $${fmt(deal.profit)}   ROI on cash ${Number.isNaN(deal.roi) ? "n/a" : (deal.roi * 100).toFixed(0) + "%"}`);
line(`  Max offer     $${fmt(deal.maxAllowableOffer)} at $${fmt(DEFAULT_DEAL_TERMS.targetProfit)} target`);
line();
line(`SENSITIVITY (profit)`);
line(`               rehab +0%     +10%      +20%`);
for (const a of [0, -0.05, -0.1]) {
  const row = deal.sensitivity.filter((s) => s.arvDeltaPct === a).map((s) => `$${fmt(s.profit)}`.padStart(10));
  line(`  ARV ${String(a * 100).padStart(4)}%  ${row.join("")}`);
}
line();
line(`RISK FLAGS`);
for (const f of report.riskFlags) line(`  - [${f.code}] ${f.message}`);
