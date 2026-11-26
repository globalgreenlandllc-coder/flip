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
assessment, and a RentCast key as `RENTCAST_API_KEY` for real sold prices.
Without the second, every result is a demo built on made-up sales, and says
so.

Other commands:

```bash
npm test            # engine, data provider and its budget, listing reader and form, safe fetching, usage limits, photo reading, both API routes
npm run demo        # end-to-end report on synthetic data, in the terminal
npm run backtest    # accuracy harness (synthetic until real CSVs exist)
npm run rentcast:check -- "street, city, ST zip"   # what RentCast says of a real house (spends real requests; see the script)
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
`RENTCAST_API_KEY` (real sold prices; see below), and the Neon `DATABASE_URL` /
`DATABASE_URL_UNPOOLED` set by the integration. The build runs
`prisma migrate deploy` before `next build`. A setting changed on the project
takes hold with the next deployment.

Clerk is still the development instance. Before real customers sign up,
create a production instance in the Clerk dashboard and swap the two keys.

## Limits, safe fetching, and the DEMO label

**Usage limits** (`lib/usage/`). A full analysis costs AI money, so each
person has a monthly allowance and a short-window rate limit, and everyone
together has a daily ceiling. Quick Numbers costs nothing to run and only has
a rate limit. Every run is a row in `UsageRun` with its status, photo count,
model and token counts: that table is what the limits count and the record of
what an analysis costs. Only runs where the AI produced an answer count
against the month. An attempt that ends before the AI is asked (no photos, a
blocked link), or where the AI service never answered, does not. A run turned
away by a limit leaves no row, and a run that never reported how it ended
stops counting after 15 minutes, so neither a limit nor a database hiccup can
use up anyone's allowance.

| Setting | Default | What it limits |
|---|---|---|
| `FLIP_MONTHLY_ANALYSES` | 40 | full analyses per person per calendar month (UTC) |
| `FLIP_ANALYSES_PER_10_MIN` | 6 | analyses that reach the AI, per person per 10 minutes |
| `FLIP_ATTEMPTS_PER_10_MIN` | 30 | tries at an analysis of any kind, per person per 10 minutes |
| `FLIP_QUICK_PER_10_MIN` | 60 | Quick Numbers runs per person per 10 minutes |
| `FLIP_DAILY_ANALYSES_ALL` | 150 | full analyses per day (UTC), everyone together |

Setting `FLIP_MONTHLY_ANALYSES` or `FLIP_DAILY_ANALYSES_ALL` to `0` switches
analyses off. Set a spend limit in the Anthropic console as well: these
limits bound the bill, that one stops it. If the count cannot be taken, a full
analysis is refused (503) and Quick Numbers, which costs nothing, runs anyway.

**Safe fetching** (`lib/net/safe-fetch.ts`). A listing link or photo link is
whatever a person pasted, so the server fetches it only through `safeFetch`:
http or https on the default port, no credentials, and every address the name
resolves to must be on the public internet. That is checked at connect time,
so a name that changes its answer gains nothing, and again on every redirect.
Bodies are capped after decompression (gzip and deflate only; brotli is
refused), and however an exchange ends its socket and decompressor are
destroyed at once. Uploaded and fetched photos must be real JPEG, PNG, WebP
or GIF files by their first bytes, whatever their label. The page reader
(`lib/listing/html.ts`) finds tags and text by scanning, one pass over the
page, so a page built to be slow to read is not (see below).

**Inputs** (`lib/api/inputs.ts`). Both routes check everything a caller sends
before a run is started. What a person typed (the deal's numbers) must be a
number inside a sane range, and a 400 names the field in plain words. What a
parser read off a page (a listing's facts, photo links) is kept when sane and
left out when not: nobody can fix a parser's mistake from the form.

**AI failures** (`lib/vision/analyze-photos.ts`). An answer that was generated
is paid for even when it cannot be used; a request that brought no answer
back is not. The person is told which of three things will help: wait, use
different photos, or nothing (it is ours to fix). The AI service's own error
text stays in the log.

**DEMO** (`lib/data/demo.ts`, `components/ui/demo.tsx`). A result built on
the made-up sales is a demo: the API says `demo: true`, the verdict badge
carries the word DEMO, and each number built on the made-up sales or the
made-up property record is tagged, risk flags included (the ones read off the
photos are real and are not). The AI is told only what the listing gave,
never a made-up year or neighbourhood. That is every result while no data
provider is connected, and with one connected, any result real data could not
be had for (it says why first). A saved deal keeps where its numbers came
from in `Deal.provider`; deals saved before that column existed have none and
are shown as demos. Quick Numbers and `POST /api/v1/evaluate` take no address
and always run on the demo's house.

## Real sold prices

With `RENTCAST_API_KEY` set, a full analysis is built on the house's own
public record and on real sold homes around it, read from RentCast
(`lib/data/`). Nothing else changes hands: the listing still comes from the
person, the photos still go to the AI.

**What is asked** (`rentcast.ts`, `house-data.ts`). Two questions: the
property record at the listing's address, and the single homes of similar
size that sold around it. One request returns at most 500 records and does
not say which 500 (asked for five miles around a house in Graham, the real
service left out nearly everything between one mile and three), so the
search widens in the engine's own steps, each small enough to come back
whole: a mile and a year; then, only if that leaves fewer than five
comparable sales, two and a half miles and eighteen months; then five miles
and two years. Where even one step matches more than 500, it is asked again
over the radius that would hold about 425 of them if they were spread
evenly. When that comes back whole, every sale within it has been read and
the result says so; when it does not (homes stand closer together near the
house), or cannot be asked, the result says that what it read is a part and
may not include the nearest. A house in a town costs two
requests and one further out three or four. Five is the most one run may
send: the record and four searches, each counted whether it was answered
from what was kept, by RentCast, or not at all, so that a later run for the
same house asks the same questions and stops in the same place. All the
asking for one house has 40 seconds.

**Is it the same house** (`address-match.ts`). An answer is not taken on
trust: a service that places addresses on a map can answer with the house
next door. Whether RentCast ever does has not been seen; the check does not
depend on it. Nor can two addresses be compared letter by letter (the listing
says "13013 224th Street East", the record "13013 224th St E"), so both are
taken apart the same way and compared part by part. The street number must
be the same, as written ("500-4" is not "5004"). A unit must be the same
unit, or absent on both sides: a unit is whatever follows "#", "Apt", "Unit"
and the like, whatever it is called ("4", "12-B", "PH1", "A-1"), and any
part of the address that stands between the street and the city
("Penthouse", "Rear"); a building, a floor or a room is not the unit of the
same number, and a hyphen between two numbers is part of a unit's name
("11-2" is not "1-12"). The street's own name must be the same ("N St" is not "North
St"). The kind of street ("St", "Ave", "St Ct") must be the same, or the one
kind left out on one side ("224th St E" is not "224th St Ct E"); the compass
words the same wherever they stand, or none on one side ("100 N Main St" is
not "100 Main St S"). And the place: the same zip code, or, where one side
gives no zip, the same city, and never two states. With neither to go by it
is not known to be the house.

A page often gives an address in two pieces, which arrive with no comma
between street and city ("1500 S 336th St Federal Way, WA 98003"), and
nothing in such a line says where the street ends: "Way" is a kind of
street. So the record's own city is looked for at its end. Where the line
names another city for the same zip code (a post office serves more than
one), it must begin with the record's whole street, kind and compass words
and all, and go on with one word that can only be a city's name: a city of
two words ("South Hill", "Des Moines") is not found that way, because two
words after a street may be more street ("5300 Lake St Clair Dr SE" is not
"5300 Lake St"). With its comma in place a line is read as the comma says.

The rule errs toward "not this house" on purpose: a wrong record would put
another house's facts and comps under a real result. It was built against
three tables of pairs (`address-match.test.mts`): 113 that are one house
written two ways, 88 that are two houses, and 12 that are one house as
likely as not and are turned away all the same, so that taking one of them
is a decision somebody makes. And against houses made from parts and written
every way a listing writes them (a spread of them in `npm test`;
`FLIP_ADDRESSES=full` reads forty times as many). A house it turns away gets
the demo, and is told which of two things happened: the records have no such
property, or they answered with a record (its address is given) that could
not be told to be the same home.

**What is kept** (`rentcast.ts` `PropertyRecord`). Of each record: where it
is, its size, rooms, year, lot, garage spaces when counted, its kind, and its
last sale. The owner's name and mailing address, the legal description and
the tax history are in RentCast's answer and are never read into a variable,
stored or logged. Every answer is kept in `DataCache`, already reduced (a
house's record for 30 days, a search for 7), so the same question is not
paid for twice: the same house, however its address is written ("Rd." or
"Road", "North Main" or "N Main", a comma more or less, the zip with its
four extra digits), with a size within the same hundred square feet. An
answer that holds another house's record is the answer to one writing of the
address and to no other ("Apt 4" may be found where "#4" was not). It is
kept for a day under the address exactly as it was written, so that the same
writing is not paid for twice in a sitting, and is never said of another
writing or served as the house's. "No such address" costs nothing and is not
kept at all. "No home sold that matched" is an answer and is kept like one,
so a house in the country, whose first mile is empty, does not need the
budget again to be told so. A second run
started while the first is still asking waits for its answer, for no longer
than its own time. Only an answer is shared: when a question is refused or
fails, the first of those waiting asks again and the rest wait for that one.
Another size is another search. What a later run does pay for is what an
earlier one asked and got no answer to.

All the asking for one house has 40 seconds, whatever the database and the
service do: past that the caller has its answer (the demo, with the reason),
a request already sent is still finished, recorded and kept for next time,
and a request not yet sent is not sent and comes off the record.

The sold homes are read as they stand today. A valuation dated another day
(the API takes `asOf`; the app never sends one) gets the demo and is told
why: a record keeps only a home's last sale, so what stood on record on
another day cannot be read now.

**What it costs, and the budget** (`budget.ts`). RentCast bills a request
answered 200; it has no hard cap, and every request past the plan's monthly
number is charged by itself (20 cents on the free plan); its month runs from
the day the plan was opened. So flip keeps its own count in `DataRequest`:
at most `FLIP_RENTCAST_REQUESTS` (default 40, for the free plan's 50) in any
31 days in a row, and at most `FLIP_RENTCAST_PER_PERSON` (default 30) of
those caused by one person. A request is written down before it is sent and
counted after, so a burst can be refused too eagerly, never let past the
budget; one that got no answer counts, because it may have been billed; one
answered with another status (an address that is not on record) does not.
If the count cannot be taken, nothing is sent. `FLIP_RENTCAST_REQUESTS=0`
switches real data off. Set the plan's own usage alerts in RentCast's
dashboard as well.

What that count does not see is everything asked with the same key from
somewhere else: `npm run rentcast:check` (which keeps a count of its own for
one run), a preview deployment with its own database, `npm run dev` with the
key. The plan's month is one, whoever asks. So the default leaves ten of the
fifty over, the key belongs on Production only, and checking twenty houses
by hand (40 to 80 requests) needs the paid plan or the site's budget set to
0 for that month.

A run that ends before the AI is asked does not count against a person's
month of analyses, and may still have spent data requests (a house with a
record and nothing to compare it with). What bounds that is the person's
share. On the free plan two accounts can use up everybody's real data for a
month; nobody can make it cost money.

**When real data cannot be had** for a house (no address came with the
listing, no such record, land or an apartment building, nobody gives its
living area, the records around it give sale dates and no prices, the budget
or the person's share used up, the service down or refusing flip's key), the
analysis still runs, as a demo, and the first line of its DEMO notice says
which of those it was. A result is never part real sales and part made-up
ones. Two more reasons are not about the house: an answer that could not be
told to be its record (said with the address that came back), and a
valuation dated another day than today. A house with a record and no
comparable sold homes ends before the AI is asked, for free, and is told how
far the search really went, on what day the records were read (an answer may
have been kept for up to a week), and which of three things it found: that
no home of similar size sold there, that homes sold and none has a price on
record that can be used, or that homes sold and none is close enough to this
one to price it from. Which of their differences leaves them out is not
said, since no one of them is known to be the reason.

**UNTESTED, and CHECK FIRST** (`lib/engine/gate.ts`). The sold prices are
real. The method that turns them into a resale value has only ever been run
against made-up data, and its adjustment rates are placeholders. So every
result built on real sales says UNTESTED in the verdict itself, shows where
its numbers came from (which record, how many sold homes within what
distance, how fresh), says so when what it read was a part (more homes
matched than one request returns) or when the search could not be taken as
wide as it would have gone, and lists every sale used with its address and
date so it can be checked. The engine widens no further than the search did:
sales read within two and a half miles are never called "comps within five".
And a GO is never given: where the deal math says GO, the verdict is CHECK
FIRST with what would clear it. The area's accuracy test is one reason; a
low-confidence resale value is a second, said as what makes it low (too few
comparable sales, prices that lie far apart, or sales that had to be looked
for far away), not as a list of what it might be. TIGHT and PASS stand as
they are.

What a saved deal is saved as is decided on the server
(`lib/data/demo.ts` `providerToSave`): a demo, or a result on real sold
prices that is not a GO. Nothing else, so nothing saved is ever shown as a
verdict without its mark. The numbers in it still rest on the browser's word
for a result computed earlier, and only that person ever sees it.

**What the engine does with real records** (`comps.ts`, `ceiling.ts`,
`defaults.ts`). They differ from the demo's in four ways. *They do not say
what condition a house sold in*: no sale is adjusted for condition, the value
is what homes like this one have been selling for and not what the
best-finished one fetched, confidence is never HIGH, and the ceiling is drawn
from the dearest tenth of the sold homes of similar size that were read
around the house and stand in its zip code (ten or more), not from
"renovated" ones. It is said as that, never as "the zip code's": the rest of
the zip code was not read. Such a ceiling is a rough guide and never a cap:
it sets the finish level the remodel plan advises and takes no line out of
it, and where the homes sold right around the house went for more than it,
the report says the ceiling is not known. *They leave facts out*: a fact one
side does not give (a garage's size, as a rule) makes no adjustment, is named
on the comp's row, and is shown for the house as "not known", never as a
number. The one place a number is assumed is the remodel plan's bathrooms
line, which prices an unknown count as two and says so. *They carry prices
that were never a market price*: a sale whose price per square foot is under
a quarter or over four times the median of all the sales read (five or more)
is left out, and the report says how many were. The band is that wide on
purpose: at half and twice it would leave out a street that really is cheap,
or dear, next to the mile around it. A sale dated before the year the house
was built was the sale of the lot, and is not read as a sold home at all;
nor is a "price" under $10,000. And a new house's record shows the builder's
purchase of the lot until the finished house sells: a sale in the year the
house was built at under half the going rate per square foot is left out as
that (six of them on a new street were the nearest comps of every house on
it, and put a $520,000 house at $133,000). *They are old*: a sale reaches
the records about three months after it closes (seen on real answers for
Seattle and Graham, 2026-11-25); older sales are taken at the price they
sold for, with no rate for time until one is fitted, and a newest comp older
than four months is a risk flag. Land does not count the same by the foot at
every size: the first 10,000 sqft of a lot in full, the rest of an acre at a
quarter, acreage beyond at a twentieth (a flat rate once threw out four comps
of five for a house on an acre).

**Listing against record.** Where the listing and the public record disagree
(living area a tenth apart, a bedroom or a whole bathroom, the year by more
than two), the result carries a risk flag that says both and why it matters:
space the county has no record of is often work done without a permit. The
valuation goes by the listing.

Not measured: how right any of this is. The check of RentCast on 20 real
houses and the accuracy test against completed flips are the next two steps;
`npm run rentcast:check` is the tool for the first, and its requests come
out of the same plan as the site's (see the budget above).

## What the listing said

`lib/listing/` keeps what a listing page says instead of three numbers: its
description as written, its facts, each with where on the page it was read
(`data`, `text`, `meta`, `link`) and the page's own words, and the labelled
lines of its detail sections ("Sewer: Septic Tank"). They come back with the
result as `listing`, show on the listing card, and are saved with a deal.

**A sentence is not a fact** (`listing-facts.ts`). A page says many things
that look like a fact about the house and are not: "detached shop built in
2019" in the remarks of a 1948 house, a month's "Property taxes $452" in a
payment calculator, the bedrooms of the similar homes further down. So a fact
is taken only from a place that says that one thing: a line of its own
("Built in 1987"), a label beside its value, or the page's own data when
every mention of it on the page agrees. Where the text states a fact twice,
the first statement stands: a page says its own house first. A reading that
needs a unit or a period and has none ("Lot size: 7,405", "HOA: $420") is not
guessed at; its line is kept among the details as written. Text with no lines
to go by (the
button on a listing page hands over one run of words; a link preview is a
sentence) gives only `loose` readings: shown with the words around them,
never used for the numbers.

**The house's own part of the page** (`zone.ts`). A listing page goes on to
show other homes, and their prices, rooms and addresses are never this
house's. Everything is read from the lines before the page turns to them.
That turn is told by another home, never by words alone: "Similar homes" also
stands in a row of tabs under the price, and "Other listings by this agent"
in the header card, where what follows is the house itself. Another home is
a card: a price the page has not given before, by itself on its line, with
an address the page has not given before beside it (a whole address, or only
its street). The house's part ends at a heading over other homes that such a
card follows, and, whatever the heading says, at such a card with bedrooms
under its price once the page has given its own price and rooms and gone on
to describe the house. A price with rooms under it and no new address is the
house itself: its own price box under its remarks on a two-column page, an
estimate with the house's rooms repeated under it.

**The headline** (`fetch-listing.ts`). Beds, baths and living area are read
where the page says them side by side, each number with its own unit ("4 bd
3 ba 2,340 sqft", "4 BR | 3 BA | 2,340 SF", "Beds: 4 / Baths: 3 / Sq Ft:
2,340"), or where it states them on lines of their own ("4" over "beds",
"Approx. 2,340 sq. ft."). Whichever the page says first is the house's, and
the other fills what the first left out only when the two agree wherever
both speak. Words between the numbers make a sentence, and a sentence is not
read. The page's data is used when it contradicts none of that, and a link
preview's sentence counts first only when it gives all three.

The asking price is an amount of $10,000 or more that nothing says is other
money: an estimate, a value somebody put on the house, a past sale, the size
of a price cut, either end of a range. That is said by a label right before
the amount on its line, or by itself on the line above it ("Home value" /
"$561,200") or under it ("$561,200" / "Estimate"). The price a listing used
to have, shown right after the price it has ("$549,000" / "$575,000"), is
other money too. An amount standing by itself on its line, or behind the word
"price", is believed before one inside a phrase ("$40,000 in upgrades"),
wherever the two stand. It is looked for just above the rooms, then at the
top of the page, then in the dozen lines under the rooms. When what stands
above the rooms is the house's own other money (what it sold for, an
estimate of it), the page has no asking price and none is taken from further
down; when it is a lender's banner or the size of a price cut, the price box
under the rooms is still read. A text with no lines (the button on a listing
page) has nothing standing by itself: there what is above the rooms comes
first, and a small amount beside a much larger one gives way to it.

An address is read backwards from ", ST 12345" (or "City ST 12345", the post
office's way, when the street is on the same line). Its house number is the
first number of the run before the city ("1234 E 4500 S", "45200 12 Mile
Rd"), not counting what a number is counted in ("2 bd 1 ba 850 Square Feet
712 Day Lily Ln") or a number with a name between it and the next ("Sq Ft
850 Windfall Realty 100 Main St"). A city by itself on its line takes the
line above it as its street only when that line is a street and nothing
else: the line over a city can also be "Built in 1987" or "1 of 37".

Of several addresses on a page, where each stands says whose it is before
any word does: the house's is beside its price or its rooms (over them,
between them, right under them), failing that above them. What stands over
an address only settles between two that stand alike: a site's own name, a
breadcrumb or "Listed by" over the house's own address is ordinary, and so
is an office's address under the same words in the price box or at the foot
of the page.

**Which facts the valuation uses** (`subject.ts`). Living area, bedrooms and
bathrooms from the listing, as before, and the year built when it is not a
loose reading. The listing's lot and garage are read and shown but not used:
a misread lot ("on a 1/4 acre lot") once emptied a comp set. With real
records connected the lot comes from the public record instead, and counts
less by the foot the larger it is. `subjectSources` in the result says, fact
by fact, whether it came from the listing, the request or the provider's
record, and the report says the same in words.

**The description.** Everything under its heading on the page, bullets
included; the page's own data when that carries the same words in full; and
failing both, the first long paragraph of prose, marked as a guess. A link
preview's summary is kept as a summary, with the note that the description
itself did not come through. The longest string called "description" in a
page's data is usually the cookie notice, and is not a rule.

**One house at a time** (`form.ts`, `house.ts`, `address.ts`). A reading
belongs to the link it was made with. When the form moves on to another house
(another link, or a pasted page with another address, or failing an address
another price, bedroom count or size), the reading goes, the photo links it
filled in go with it, and so does the asking price, typed or not. Photos the
person added themselves stay, the form says so, and a pasted link does not
start by itself while they or a typed price are in the form. The API refuses
a `listing` whose own link is a different page from `listingUrl`, and one
whose address is a different house from what the server read at the link.
When the site turns the server away the reply says `blocked: true`, also when
the person's browser had read the page.

**Order of an analysis.** Whether there are sold homes to compare with is
asked before the AI is. A house nothing can be compared to ends there for
free, not after its photos were paid for.

**Reading pages in one pass** (`html.ts`). Tags, their attributes and the
visible text are found by scanning, never by a pattern that can run past a
tag's end: one page built for the old patterns took six minutes.
`listing-facts.test.mts` times pages built to be slow through every way a
page is read.

**Generated pages** (`corpus.test.mts`, `corpus-pages.mts`). Single test
pages were not enough: a rule added for one page changed what was read on
others. So one test builds ordinary pages out of small parts in every
combination: where the price, the address and the rooms stand (also with the
remarks before the price box, the way a two-column page reads), how each is
written, what a site puts around its price (a lender's banner, an old price,
a cut, an office's address), what stands over the address, and how the page
shows other homes underneath. It does that for four houses and reads each
page every way a page arrives. The price, the beds, the baths, the living
area, the address and the year built each have to be the house's own, or
absent where the page does not state it; and what a page says only of the
homes it goes on to show is not read at all. `npm test` reads a spread of
about 6,800 of these pages; `FLIP_CORPUS=full` reads all 20.4 million, which
takes several hours in one process and about half an hour with one process
per house and kind of page (the test's header says how).

Not exercised against real listing sites. The pages in the tests, generated
ones included, are written by hand in the way those sites lay theirs out;
how well the reader does on the real ones is measured in the accuracy step.

**Tests.** `lib/api/handlers.test.mts` runs both routes with stand-ins for
the session, the database, the network, the data provider and the AI;
`lib/vision/analyze-photos.test.mts` runs the photo reading against a
stand-in for the AI's API on this machine; `lib/data/` is tested against a
stand-in for RentCast's API (`rentcast-fixtures.mts`: made-up addresses in
the real answers' shape, each with an owner block the reader must drop). The
counting rules of both stores (usage limits, the data budget) run against a
real Postgres when one is named:
`FLIP_TEST_DATABASE_URL=postgresql://…@127.0.0.1/… npm test` (a database on
this machine with the migrations applied; the tests refuse any other host).

## How the valuation works

**Comp selection with progressive relaxation.** Start at 0.5 mi / 6 months /
±20% sqft. Widen tier by tier until at least five comps survive. Confidence
drops with every tier used. (Real sold records widen further, to 5 mi / 24
months: see "Real sold prices".)

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
lib/listing/    what a listing page says: html.ts scans it, listing-facts.ts reads facts and description,
                fetch-listing.ts the headline and photos, read-listing.ts fetches, subject.ts picks what the
                valuation may use, form.ts + house.ts keep the form to one house
lib/data/       where the sold homes and property records come from: rentcast.ts (the wire), budget.ts (what may be
                spent, and the kept answers), house-data.ts (one house's data, real or the demo's and why),
                synthetic-provider.ts (the demo), demo.ts = "is this a demo, or real and untested?"
lib/net/        safe-fetch.ts: the only way the server fetches an address a person supplied
lib/usage/      per-person limits and the UsageRun log (limits.ts rules, prisma-store.ts storage)
lib/api/        the two API routes without their plumbing (testable), and input checks
app/            landing, auth pages, app shell (/app), API routes
components/     report views, analyzer, evaluator, app shell pieces
prisma/         Deal, UsageRun, DataRequest and DataCache models (Postgres)
scripts/        demo.mts, backtest.mts, rentcast-check.mts
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
The photo assessment is real. With a RentCast key the property record and
the sold homes are real too; without one, all market data is synthetic
(`lib/engine/synthetic.ts`). Either way the adjustment and rehab rates in
`lib/engine/defaults.ts` / `lib/engine/renovation.ts` are placeholders, and
no result has been accuracy-tested. Nothing here is a valuation until the
rates are fitted and the accuracy test is passed.

Listing links: paste one and the analysis starts. The page is read for its
metadata and photos. Zillow, Redfin, Realtor and Trulia block server reads,
so for those the address is taken from the link and the same MLS listing is
read from Estately (`lib/listing/resolve.ts`); the report says so. Movoto
and most brokerage sites are read directly. Fallbacks when nothing works:
the Chrome extension (`extension/`, reads pages through the user's browser),
copy-and-paste of the listing page, or dragging photos in.
