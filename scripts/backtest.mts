/**
 * Backtest harness: the number that decides whether this is a business.
 *
 *   npm run backtest -- data/flips.csv data/sales.csv
 *
 * flips.csv columns:
 *   id,lat,lng,submarket,sqft,lotSqft,beds,baths,yearBuilt,garage,condition,
 *   purchaseDate,purchasePrice,resaleDate,resalePrice
 * sales.csv columns:
 *   id,lat,lng,submarket,sqft,lotSqft,beds,baths,yearBuilt,garage,condition,price,saleDate
 *
 * For each completed flip the engine sees ONLY sales recorded before the
 * purchase date, predicts ARV, and is scored against the actual resale
 * price time-adjusted back to the purchase date. Reports median absolute
 * percentage error (MdAPE) and the 90th percentile.
 *
 * With no arguments it runs on synthetic data so the harness itself is
 * exercised; that result means nothing about the real world.
 */
import { readFileSync } from "node:fs";
import { DEFAULT_MARKET_CONFIG, estimateArv, monthsBetween } from "../lib/engine/index.ts";
import type { PropertyFacts, Sale, Condition } from "../lib/engine/index.ts";
import { generateMarketData } from "../lib/engine/synthetic.ts";

interface Flip extends PropertyFacts {
  purchaseDate: string;
  purchasePrice: number;
  resaleDate: string;
  resalePrice: number;
}

function parseCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((h, i) => [h, (cells[i] ?? "").trim()]));
  });
}

function toFacts(r: Record<string, string>): PropertyFacts {
  return {
    id: r.id,
    lat: Number(r.lat),
    lng: Number(r.lng),
    submarket: r.submarket,
    sqft: Number(r.sqft),
    lotSqft: Number(r.lotSqft),
    beds: Number(r.beds),
    baths: Number(r.baths),
    yearBuilt: Number(r.yearBuilt),
    garage: Number(r.garage),
    condition: r.condition as Condition,
  };
}

function loadReal(flipsPath: string, salesPath: string): { flips: Flip[]; sales: Sale[] } {
  const flips = parseCsv(flipsPath).map((r) => ({
    ...toFacts(r),
    purchaseDate: r.purchaseDate,
    purchasePrice: Number(r.purchasePrice),
    resaleDate: r.resaleDate,
    resalePrice: Number(r.resalePrice),
  }));
  const sales = parseCsv(salesPath).map((r) => ({ ...toFacts(r), price: Number(r.price), saleDate: r.saleDate }));
  return { flips, sales };
}

/** Synthetic flips: renovated sales re-cast as flips bought 8 months before they sold. */
function loadSynthetic(): { flips: Flip[]; sales: Sale[] } {
  const { sales } = generateMarketData({ seed: 99, count: 1200, asOf: "2026-09-01" });
  const flips: Flip[] = sales
    .filter((s) => s.condition === "renovated")
    .sort((a, b) => (a.saleDate < b.saleDate ? 1 : -1))
    .slice(0, 75)
    .map((s) => {
      const purchase = new Date(new Date(s.saleDate).getTime() - 8 * 30.4375 * 86400000).toISOString().slice(0, 10);
      return { ...s, condition: "dated", purchaseDate: purchase, purchasePrice: s.price * 0.7, resaleDate: s.saleDate, resalePrice: s.price };
    });
  return { flips, sales };
}

const [flipsPath, salesPath] = process.argv.slice(2);
const { flips, sales } = flipsPath && salesPath ? loadReal(flipsPath, salesPath) : loadSynthetic();
if (!flipsPath) console.log("No CSVs given: running on SYNTHETIC data. This proves the harness, not the model.\n");

const errors: number[] = [];
let skipped = 0;
for (const flip of flips) {
  const known = sales.filter((s) => s.saleDate < flip.purchaseDate && s.id !== flip.id);
  const arv = estimateArv(flip, known, flip.purchaseDate, DEFAULT_MARKET_CONFIG);
  if (Number.isNaN(arv.point)) {
    skipped++;
    continue;
  }
  const holdMonths = monthsBetween(flip.purchaseDate, flip.resaleDate);
  const actualAtPurchase = flip.resalePrice / (1 + DEFAULT_MARKET_CONFIG.monthlyAppreciation) ** holdMonths;
  errors.push(Math.abs(arv.point - actualAtPurchase) / actualAtPurchase);
}

errors.sort((a, b) => a - b);
const pct = (p: number) => errors[Math.min(errors.length - 1, Math.floor(errors.length * p))];
const within = (t: number) => errors.filter((e) => e <= t).length / errors.length;

console.log(`Flips scored: ${errors.length}   skipped (no comps): ${skipped}`);
console.log(`MdAPE:        ${(pct(0.5) * 100).toFixed(1)}%`);
console.log(`P90 error:    ${(pct(0.9) * 100).toFixed(1)}%`);
console.log(`Within 5%:    ${(within(0.05) * 100).toFixed(0)}%`);
console.log(`Within 10%:   ${(within(0.1) * 100).toFixed(0)}%`);
console.log();
console.log(pct(0.5) <= 0.05 ? "GATE: PASS (MdAPE <= 5%)" : "GATE: FAIL (MdAPE > 5%). Do not build UI on top of this.");
