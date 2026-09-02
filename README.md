# flip

Address in. **GO / TIGHT / PASS** out, with the numbers that back it up.

flip is a deal evaluator for people who buy houses, renovate them, and sell
them: contractors, small investors, and the agents and lenders who serve
them. It answers five questions about any listing:

1. **What's the ceiling here?** The top of this neighborhood's market. No
   finish level pushes a house past it.
2. **What does the finished version sell for?** ARV from comps matched on
   sqft, beds, baths, age, lot and condition, adjusted for differences and time.
3. **What does it need?** Condition assessment mapped to a scope of work.
4. **What does that cost?** Rehab low / likely / high, plus a reserve for
   what photos cannot show.
5. **Does the money work?** ARV minus purchase, rehab, holding, financing and
   closing on both ends. Profit, ROI, and the max you can pay.

## Quick start

```bash
npm install
npm test            # engine unit tests
npm run demo        # end-to-end report on synthetic data
npm run demo 600000 # same property at a different asking price
npm run backtest    # accuracy harness (synthetic until real CSVs exist)
npm run dev         # Next.js app + POST /api/v1/evaluate
```

Try the API:

```bash
curl -s localhost:3000/api/v1/evaluate \
  -H 'content-type: application/json' \
  -d '{"address":"any address, synthetic provider","deal":{"askingPrice":749000}}'
```

## How the valuation works

**Comp selection with progressive relaxation.** Start at 0.5 mi / 6 months /
±20% sqft. Widen tier by tier until at least five comps survive. Confidence
drops with every tier used.

**Appraiser-style adjustments.** Each comp is time-adjusted, then adjusted
line by line (sqft, lot, beds, baths, garage, age, condition) to look like the
subject *as renovated*. Any comp needing more than 25% gross adjustment is
thrown out even if the net is near zero: two big offsetting adjustments are
two guesses stacked.

**Weighted median.** Weight = distance decay × recency decay × adjustment
size decay × sqft similarity decay. One bad comp cannot drag the answer.

**Neighborhood ceiling.** Take renovated sales in the submarket over 12
months, time-adjust, take the weighted 90th percentile of $/sqft. Then

```
realistic ARV = min(comp-based ARV, ceiling × subject sqft)
```

If comp math says $700k but the block has never cleared $640k, the report
says $640k and tells the user not to over-improve. This one constraint
prevents the most common way flips lose money.

**Max allowable offer, closed form.** Financing and buy-side closing both
scale with purchase price, so the equation is circular. Solved:

```
P = [ARV(1 − cs) − rehab(1 + f·ltc) − holding − target] / (1 + cb + f·ltc)
```

**Verdict.** GO needs base-case profit at target *and* a positive result at
ARV −10% with rehab +20%. TIGHT is profitable but short of one of those.
PASS is a loss at asking.

## Layout

```
lib/engine/     pure TypeScript, no I/O: comps, ceiling, arv, deal, rehab, evaluate
lib/data/       SalesProvider / ParcelProvider seam; synthetic provider for dev
app/api/v1/     public evaluate endpoint (the same call partners will make)
scripts/        demo.mts, backtest.mts
docs/DATA.md    where real data comes from and how to calibrate
```

The engine is the product. It runs unchanged in the API, in the backtest
CLI, and later as an SDK for partners.

## Who buys it

**Contractors and small investors** buy seats. They know rehab costs and get
ARV and the ceiling wrong, which is exactly what the engine fixes. The report
doubles as a sales tool: bring a deal to an investor client with the PDF,
win the renovation contract.

**Brokerages, lenders, portals** buy an API that scores listings, a
white-label report for their agents, and a published accuracy number.
Hard-money lenders and brokerages with investor divisions come first. Redfin
and Zillow come after there is proof.

Two rules follow. Never scrape Zillow or Redfin: no portal licenses a product
built on scraping them. And the backtest is the sales deck: "our ARV was
within X% on N completed flips in this metro" is the sentence every buyer
needs to hear.

## Build order

| Phase | Weeks | Deliverable | Unlocks |
|---|---|---|---|
| 0 | done | Scaffold, engine, tests, demo, backtest harness, API route | A repo to show |
| 1 | 1–3 | King County loader, address → subject, real ARV and ceiling, regression-fit adjustment rates, backtest on 75 completed flips | The accuracy number. **Gate: MdAPE ≤ 5%** |
| 2 | 4–5 | Clerk organizations, saved deals, editable assumptions, PDF report, Stripe | First paying contractors |
| 3 | 6–8 | Photo upload, Claude vision condition scoring, rehab line items | Rehab number nobody has to type |
| 4 | 9–12 | API keys, usage metering, white-label reports, embed widget, second metro, public accuracy page | Lender and brokerage pitches |

Ship to ten contractors after phase 2. Do not start phase 2 if phase 1
misses the gate. A confident wrong ARV loses a customer the first time it
costs them money.

## Status

Phase 0. All market data is synthetic (`lib/engine/synthetic.ts`) and the
adjustment rates in `lib/engine/defaults.ts` are placeholders. Nothing here
is a valuation until phase 1 replaces both.
