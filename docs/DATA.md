# Data

The engine never talks to a data source. Everything comes in through
`lib/data/provider.ts`:

- `ParcelProvider.lookup(address)` turns a street address into `PropertyFacts`.
- `SalesProvider.salesNear(subject, radius, months, asOf)` returns sold records.

## Phase 1 target: King County

Public, free, and enough to calibrate the model and run the backtest.

| Need | Source |
|---|---|
| Parcel facts (sqft, lot, beds, baths, year built, garage) | King County Assessor extracts: `EXTR_ResBldg`, `EXTR_Parcel` |
| Sales with price and date | Assessor `EXTR_RPSale` (REET records) |
| Lat/lng | Assessor parcel centroids or geocode the address |
| Submarket key | Zip to start; census tract once it is joined |
| Condition | Assessor `Condition` and `BldgGrade` fields, then photos in phase 3 |

Load these into Postgres, implement `KingCountyProvider`, and set
`DATA_PROVIDER=kingcounty`.

## Calibration

`DEFAULT_MARKET_CONFIG` holds placeholder adjustment rates. Fit them per
submarket by regressing time-adjusted sold price on sqft, lot, beds, baths,
garage, age and condition. The coefficient on sqft is the marginal rate the
engine needs and is usually well below average $/sqft.

## Backtest input

`scripts/backtest.mts` documents the two CSV layouts. A completed flip is a
parcel with two REET sales inside 12 months where the second is materially
higher; the assessor data alone can produce the list.

## What not to do

Do not scrape Zillow or Redfin. It breaks constantly and no brokerage or
portal will license a product built on it. Listing photos come from the
user or from an MLS feed through a broker partner.
