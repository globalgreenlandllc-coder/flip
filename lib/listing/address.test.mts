import { test } from "node:test";
import assert from "node:assert/strict";
import { streetDetails } from "./address.ts";

test("street details: directions, street type and unit, each written one way, from the street line only", () => {
  const cases: [string, ReturnType<typeof streetDetails>][] = [
    ["608 Sample St, Fixture Falls, WA 98000", { directions: null, type: "st", unit: null }],
    ["608 Sample Street, Fixture Falls, WA 98000", { directions: null, type: "st", unit: null }],
    ["1234 NE 45th St, Seattle, WA 98105", { directions: "ne", type: "st", unit: null }],
    ["1234 45th St NE, Seattle, WA 98105", { directions: "ne", type: "st", unit: null }],
    ["1234 Northeast 45th Street, Seattle, WA 98105", { directions: "ne", type: "st", unit: null }],
    ["500 Lake Washington Blvd S, Seattle, WA 98144", { directions: "s", type: "blvd", unit: null }],
    // A unit after a comma (as RentCast writes it), after "#", after "Apt" or "Unit": the same unit.
    ["123 Main St, Apt 4, Seattle, WA 98101", { directions: null, type: "st", unit: "4" }],
    ["123 Main St #4, Seattle, WA 98101", { directions: null, type: "st", unit: "4" }],
    ["123 Main St Unit 4-B, Seattle, WA 98101", { directions: null, type: "st", unit: "4b" }],
    ["123 Main St # 4B, Seattle, WA 98101", { directions: null, type: "st", unit: "4b" }],
    // The rest of the street line after a unit is the unit's, not a direction.
    ["123 Main St #4 E, Seattle, WA 98101", { directions: null, type: "st", unit: "4e" }],
    ["608 Avenue A, Fixture Falls, WA 98000", { directions: null, type: null, unit: null }],
    // "St" first is a street called St Helens; the city's own words are not the street's ("North Bend").
    ["608 St Helens Ave, Tacoma, WA 98402", { directions: null, type: "ave", unit: null }],
    ["608 Sample Ave, North Bend, WA 98045", { directions: null, type: "ave", unit: null }],
    // A word that only looks like a type or a direction in a street's name does not trip anything up.
    ["608 Constructor Ln, Fixture Falls, WA 98000", { directions: null, type: "ln", unit: null }],
  ];
  for (const [address, details] of cases) assert.deepEqual(streetDetails(address), details, address);
  // Written without the commas before the city: nothing can be told.
  assert.equal(streetDetails("608 Sample St Fixture Falls WA 98000"), null);
  assert.equal(streetDetails(undefined), null);
});
