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
npm install                      # also runs prisma generate
npx clerk@latest init --framework next -y   # dev auth keys, no Clerk account needed
npx prisma migrate dev           # local SQLite for saved deals
npm run dev                      # http://localhost:3000
```

Put an Anthropic key in `.env.local` as `ANTHROPIC_API_KEY` for the photo
assessment. Everything else runs without it.

Other commands:

```bash
npm test            # engine, renovation and listing-parser unit tests
npm run demo        # end-to-end report on synthetic data, in the terminal
npm run backtest    # accuracy harness (synthetic until real CSVs exist)
npm run typecheck && npm run lint
```

### Auth

Sign-in is Clerk. `clerk init` provisions a development instance and writes
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`;
run `npx clerk@latest auth login` later to claim it into your Clerk account.
Route protection lives in `proxy.ts`: `/app` redirects to sign-in, `/api/v1`
returns a JSON 401.

### Routes

| Route | What |
|---|---|
| `/` | Landing page |
| `/sign-in`, `/sign-up` | Clerk |
| `/app` | New analysis: listing link + photos → verdict, remodel plan, report |
| `/app/deals`, `/app/deals/[id]` | Saved deals per user |
| `/app/quick` | Deal math without photos |
| `POST /api/v1/analyze` | Listing URL and/or photos → assessment, plan, report |
| `POST /api/v1/evaluate` | Facts + deal terms → report |

Try the API as a signed-in user (session token as a Bearer):

```bash
curl -s localhost:3000/api/v1/analyze \
  -H "Authorization: Bearer $SESSION_JWT" -H 'content-type: application/json' \
  -d '{"listingUrl":"https://www.zillow.com/homedetails/…","deal":{"askingPrice":599950}}'
```

## Deploy

Production runs on Vercel with a Neon Postgres from the Vercel marketplace.
The GitHub repo is connected, so every push to `main` deploys.

```bash
npx vercel link                       # once per machine
npx vercel env pull .env.vercel.local # Neon connection strings
npx vercel --prod                     # manual deploy
```

Environment variables on the project: the Clerk keys and URLs, `ANTHROPIC_API_KEY`,
`DATA_PROVIDER`, and the Neon `DATABASE_URL` / `DATABASE_URL_UNPOOLED` set by the
integration. The build runs `prisma migrate deploy` before `next build`.

Clerk is still the development instance. Before real customers sign up,
create a production instance in the Clerk dashboard and swap the two keys.

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
lib/engine/     pure TypeScript, no I/O: comps, ceiling, arv, deal, rehab, renovation, evaluate
lib/vision/     Claude vision photo assessment (structured output) + photo fetcher
lib/listing/    listing-page metadata and photo extraction from a pasted URL
lib/data/       SalesProvider / ParcelProvider seam; synthetic provider for dev
app/            landing, auth pages, app shell (/app), API routes
components/     report views, analyzer, evaluator, app shell pieces
prisma/         Deal model (SQLite locally; Postgres in phase 2)
scripts/        demo.mts, backtest.mts
docs/           DATA.md (sources, calibration), DEMO-PHOTOS.md
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

Phase 0 plus the listing analyzer and the SaaS shell (auth, saved deals).
All market data is synthetic (`lib/engine/synthetic.ts`) and the adjustment
and rehab rates in `lib/engine/defaults.ts` / `lib/engine/renovation.ts` are
placeholders. The photo assessment is real. Nothing here is a valuation
until phase 1 replaces the data and calibrates the rates.

Listing links: paste one and the analysis starts. The page is read for its
metadata and photos. Zillow, Redfin, Realtor and Trulia block server reads,
so for those the address is taken from the link and the same MLS listing is
read from Estately (`lib/listing/resolve.ts`); the report says so. Movoto
and most brokerage sites are read directly. Fallbacks when nothing works:
the Chrome extension (`extension/`, reads pages through the user's browser),
copy-and-paste of the listing page, or dragging photos in.
