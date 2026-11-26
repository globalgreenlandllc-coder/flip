# Data

The engine never talks to a data source. A full analysis gets one house's
data through `lib/data/house-data.ts`: the house's own record and the sold
homes around it, as `PropertyFacts` and `Sale[]`.

## Today: RentCast

Real sold prices and property records come from RentCast
(developers.rentcast.io) when `RENTCAST_API_KEY` is set. What is asked, what
is kept of the answers, what it costs and the request budget are in the
README under "Real sold prices". In short:

| Need | Where it comes from |
|---|---|
| The house's facts (sqft, lot, beds, baths, year built) | RentCast property record by address; the listing's own numbers stand over them |
| Garage spaces | The record, when it counts them (about one record in three) |
| Sold homes with price and date | RentCast records around the house, each with its last sale |
| Lat/lng | The record |
| Submarket key | Zip code |
| Condition | Not in any record. The subject's comes from the photos; sold homes are taken as they sold |

What it is not: fresh (a sale shows up about three months after closing),
complete (twelve states do not publish sale prices; Washington does), or
tested. Before paying for a plan, check it on 20 real houses in the launch
area with `npm run rentcast:check`: are the facts right, and does it find at
least five dated sold prices inside the comparable search.

## Next: the county's own records, for the accuracy test

Public, free, and what the accuracy test needs: sales going back years, with
the two sales of each completed flip.

| Need | Source |
|---|---|
| Parcel facts (sqft, lot, beds, baths, year built, garage) | King County Assessor extracts: `EXTR_ResBldg`, `EXTR_Parcel` |
| Sales with price and date | Assessor `EXTR_RPSale` (REET records) |
| Lat/lng | Assessor parcel centroids or geocode the address |
| Condition | Assessor `Condition` and `BldgGrade` fields |

## Calibration

`DEFAULT_MARKET_CONFIG` holds placeholder adjustment rates. Fit them per
submarket by regressing sold price on sqft, lot, beds, baths, garage, age and
condition, and the rate for time with them (real sales are taken at the
price they sold for until then). The coefficient on sqft is the marginal
rate the engine needs and is usually well below average $/sqft.

## Backtest input

`scripts/backtest.mts` documents the two CSV layouts. A completed flip is a
parcel with two REET sales inside 12 months where the second is materially
higher; the assessor data alone can produce the list.

## What not to do

Do not scrape Zillow or Redfin. It breaks constantly and no brokerage or
portal will license a product built on it. Listing photos come from the
user or from an MLS feed through a broker partner.
