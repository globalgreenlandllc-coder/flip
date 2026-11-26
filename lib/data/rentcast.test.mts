import { test } from "node:test";
import assert from "node:assert/strict";
import { NoAnswer, askRentcast, propertyUrl, recordFrom, saleFrom, salesUrl, RENTCAST_BASE_URL } from "./rentcast.ts";
import { SUBJECT_ADDRESS, fakeRentcast, record, soldHomes, subjectRecord } from "./rentcast-fixtures.mts";

test("a record is reduced to what flip uses, and the owner is not among it", () => {
  const kept = recordFrom(subjectRecord({ garageSpaces: 2 }));
  assert.ok(kept);
  assert.deepEqual(Object.keys(kept).sort(), ["address", "baths", "beds", "county", "garage", "id", "lastSale", "lat", "lng", "lotSqft", "propertyType", "soldOn", "sqft", "yearBuilt", "zip"]);
  // The day of the last sale stands by itself too: a record may give the day and not the price.
  assert.equal(kept.soldOn, kept.lastSale?.date);
  const unpriced = recordFrom(subjectRecord({ soldDaysAgo: 400, soldFor: 0 }));
  assert.deepEqual([unpriced?.lastSale, unpriced?.soldOn], [null, "2025-10-06"]);
  assert.deepEqual([recordFrom(record(5))?.lastSale, recordFrom(record(5))?.soldOn], [null, null]);
  assert.equal(kept.address, SUBJECT_ADDRESS);
  assert.deepEqual([kept.sqft, kept.beds, kept.baths, kept.yearBuilt, kept.lotSqft, kept.garage, kept.zip, kept.propertyType], [1_800, 3, 2, 1984, 7_200, 2, "98000", "Single Family"]);
  assert.equal(kept.lastSale?.price, 365_000);
  assert.match(kept.lastSale!.date, /^\d{4}-\d{2}-\d{2}$/);
  // Nothing of the owner, the legal description or the tax rolls survives the reader.
  assert.doesNotMatch(JSON.stringify(kept), /Madeup|PO Box|mailing|LOT 1 OF|assessor|480000/i);
});

test("a record says a garage's size only when it counts the spaces", () => {
  assert.equal(recordFrom(record(1, { garageSpaces: 2 }))?.garage, 2);
  assert.equal(recordFrom(record(1, { garageSpaces: 0 }))?.garage, 0);
  // "Has a garage" is not a number of spaces; "has none" is zero.
  assert.equal(recordFrom(record(1, { garage: true }))?.garage, null);
  assert.equal(recordFrom(record(1, { garage: false }))?.garage, 0);
});

test("what a record does not say, or says impossibly, is not known: never a zero and never a guess", () => {
  const thin = recordFrom(record(1, { bedrooms: null, bathrooms: null, squareFootage: null, lotSize: null, yearBuilt: null }));
  assert.deepEqual([thin?.beds, thin?.baths, thin?.sqft, thin?.lotSqft, thin?.yearBuilt], [null, null, null, null, null]);
  const zeros = recordFrom(record(1, { bedrooms: 0, bathrooms: 0, squareFootage: 0, lotSize: 0 }));
  assert.deepEqual([zeros?.beds, zeros?.baths, zeros?.sqft, zeros?.lotSqft], [null, null, null, null]);
  const silly = recordFrom({ ...record(1), squareFootage: 9_000_000, yearBuilt: 12, bedrooms: "3", lastSalePrice: -5, lastSaleDate: "yesterday", zipCode: "9800" });
  assert.deepEqual([silly?.sqft, silly?.yearBuilt, silly?.beds, silly?.lastSale, silly?.zip], [null, null, null, null, null]);
  // A record that does not say where the property is cannot be used at all.
  assert.equal(recordFrom({ ...record(1), latitude: undefined }), null);
  assert.equal(recordFrom({ ...record(1), longitude: 500 }), null);
  assert.equal(recordFrom("not a record"), null);
  assert.equal(recordFrom([record(1)]), null);
});

test("a record is a comparable sale only with a living area and a real sale price", () => {
  const sale = saleFrom(recordFrom(record(7, { soldDaysAgo: 90, soldFor: 512_000 }))!);
  assert.ok(sale);
  assert.equal(sale.price, 512_000);
  assert.equal(sale.condition, "unknown");
  assert.equal(sale.submarket, "98000");
  assert.match(sale.address!, /^107 Sample St/);
  assert.equal(saleFrom(recordFrom(record(7))!), null, "never sold");
  assert.equal(saleFrom(recordFrom(record(7, { soldDaysAgo: 90, soldFor: 512_000, squareFootage: null }))!), null, "no living area");
  // A deed for ten dollars is a transfer, not a price.
  assert.equal(saleFrom(recordFrom(record(7, { soldDaysAgo: 90, soldFor: 10 }))!), null);
  // A sale from before the house was built was the lot's, or the old house's: nothing to compare this one with.
  assert.equal(saleFrom(recordFrom(record(7, { soldDaysAgo: 400, soldFor: 95_000, yearBuilt: 2026 }))!), null);
  assert.ok(saleFrom(recordFrom(record(7, { soldDaysAgo: 90, soldFor: 640_000, yearBuilt: 2026 }))!), "a new house sold in the year it was built is a sale");
  assert.ok(saleFrom(recordFrom(record(7, { soldDaysAgo: 90, soldFor: 512_000, yearBuilt: null }))!), "a record that does not give the year is taken as it is");
});

test("the two questions are asked the way RentCast's reference writes them", () => {
  const one = new URL(propertyUrl(RENTCAST_BASE_URL, "13013 224th St E, Graham, WA 98338 & more=1"));
  assert.equal(one.origin + one.pathname, "https://api.rentcast.io/v1/properties");
  // The address is one parameter however it is written: it cannot add parameters of its own.
  assert.deepEqual([...one.searchParams.keys()], ["address"]);
  assert.equal(one.searchParams.get("address"), "13013 224th St E, Graham, WA 98338 & more=1");

  const around = new URL(salesUrl(RENTCAST_BASE_URL, { lat: 47.1, lng: -122.3, radiusMiles: 1, days: 365.25, sqft: [1_250, 2_350], propertyType: "Single Family" }));
  assert.deepEqual(Object.fromEntries(around.searchParams), {
    latitude: "47.100000",
    longitude: "-122.300000",
    radius: "1",
    propertyType: "Single Family",
    saleDateRange: "*:365",
    squareFootage: "1250:2350",
    limit: "500",
    includeTotalCount: "true",
  });
});

test("asking: the key travels in a header and nowhere else, and the answer comes back as records with the full count", async () => {
  const api = fakeRentcast([subjectRecord(), ...soldHomes(12)]);
  const found = await askRentcast(propertyUrl("https://api.test/v1", SUBJECT_ADDRESS), "secret-key", api.fetch);
  assert.equal(found.status, 200);
  assert.equal(found.records.length, 1);
  assert.equal(api.calls[0].key, "secret-key");
  assert.doesNotMatch(api.calls[0].url, /secret-key/);

  const around = await askRentcast(salesUrl("https://api.test/v1", { lat: 47.1, lng: -122.3, radiusMiles: 1, days: 365, sqft: [1_250, 2_350], propertyType: "Single Family" }), "secret-key", api.fetch);
  assert.deepEqual([around.status, around.records.length, around.returned, around.total], [200, 12, 12, 12]);
});

test("asking: any status but 200 is an answer that was not billed; no answer at all is said as that", async () => {
  const api = fakeRentcast([subjectRecord()]);
  const missing = await askRentcast(propertyUrl("https://api.test/v1", "1 Nowhere Rd, Fixture Falls, WA 98000"), "k", api.fetch);
  assert.deepEqual([missing.status, missing.records.length], [404, 0]);

  api.fail = { status: 429 };
  assert.equal((await askRentcast(propertyUrl("https://api.test/v1", SUBJECT_ADDRESS), "k", api.fetch)).status, 429);

  // A 200 that is not a list of records was billed all the same, and says so.
  api.fail = { garbled: true };
  const garbled = await askRentcast(propertyUrl("https://api.test/v1", SUBJECT_ADDRESS), "k", api.fetch);
  assert.deepEqual([garbled.status, garbled.garbled, garbled.records.length], [200, true, 0]);

  api.fail = { noAnswer: true };
  await assert.rejects(() => askRentcast(propertyUrl("https://api.test/v1", SUBJECT_ADDRESS), "k", api.fetch), (err) => err instanceof NoAnswer && err.why === "TimeoutError");
});

test("asking: a failure that quotes the key does not carry it any further", async () => {
  // What a runtime says when it refuses a header: the header's own text, key and all.
  const quoting = async () => {
    throw new TypeError('Header "x-api-key" has an invalid value: "sk-very-secret-0123"');
  };
  const failed = await askRentcast("https://api.test/v1/properties?address=x", "sk-very-secret-0123", quoting).catch((err: unknown) => err);
  assert.ok(failed instanceof NoAnswer);
  assert.equal(failed.why, "TypeError");
  assert.equal(failed.cause, undefined);
  assert.doesNotMatch(`${failed.message} ${failed.stack} ${JSON.stringify(failed)}`, /very-secret/);
});

test("asking: never from a cache, and never following a redirect, which would carry the key along", async () => {
  const api = fakeRentcast([subjectRecord()]);
  await askRentcast(propertyUrl("https://api.test/v1", SUBJECT_ADDRESS), "k", api.fetch);
  assert.deepEqual([api.calls[0].redirect, api.calls[0].cache], ["error", "no-store"]);
});

test("asking: a request that hangs is given up on, and an answer too large to be one is not read to the end", async () => {
  // A connection that never answers. (A real one holds a socket open; the timer here stands in for that, or the
  // test process would have nothing left to wait for.)
  const hangs = (_url: string, init: { signal: AbortSignal }) =>
    new Promise<Response>((_, reject) => {
      const socket = setTimeout(() => {}, 5_000);
      init.signal.addEventListener("abort", () => {
        clearTimeout(socket);
        reject(init.signal.reason);
      });
    });
  await assert.rejects(() => askRentcast("https://api.test/v1/properties?address=x", "k", hangs, 30), NoAnswer);

  // An answer that never ends, a megabyte at a time. (Its body is made by hand so that nothing of the test
  // is left for the runtime to tidy up after.)
  let pulled = 0;
  let cancelled = false;
  const megabyte = new Uint8Array(1_000_000).fill(32);
  const endless = {
    status: 200,
    headers: new Headers(),
    body: {
      getReader: () => ({
        read: async () => {
          pulled++;
          return { done: false, value: megabyte };
        },
        cancel: async () => {
          cancelled = true;
        },
      }),
    },
  } as unknown as Response;
  const huge = await askRentcast("https://api.test/v1/properties?address=x", "k", async () => endless);
  assert.deepEqual([huge.status, huge.garbled], [200, true]);
  assert.ok(pulled < 20 && cancelled, `read ${pulled} MB of an endless answer`);

  // An answer that starts and then stalls is given up on at the same deadline as one that never starts.
  const stalls = { status: 200, headers: new Headers(), body: { getReader: () => ({ read: () => new Promise(() => {}), cancel: async () => {} }) } } as unknown as Response;
  const socket = setTimeout(() => {}, 5_000);
  await assert.rejects(() => askRentcast("https://api.test/v1/properties?address=x", "k", async () => stalls, 30), NoAnswer);
  clearTimeout(socket);
});
