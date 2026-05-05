/**
 * Build script: convert SWAT outputRch xlsx → compact bundled JSON.
 *
 * Reads `attached_assets/outputRch_*.xlsx` (1095 daily rows × 25 reaches with
 * FLOW_OUTcms / TOT Nkg / TOT Pkg) and writes a single JSON to
 * `artifacts/shizugawa-dashboard/src/data/reachData.json`.
 *
 * Output shape (parallel arrays for size efficiency):
 *   {
 *     startDate: "YYYY-MM-DD",
 *     endDate:   "YYYY-MM-DD",
 *     days: number,                 // total day count (= 1095 for 2021–2023)
 *     years: number[],              // [2021, 2022, 2023]
 *     reaches: {
 *       [rch: string]: {
 *         flow: number[]            // m³/s    length = days
 *         n:    number[]            // kg/day  length = days
 *         p:    number[]            // kg/day  length = days
 *       } | null                    // null = reach has no model output
 *     },
 *     bounds: {                     // global min/max per variable (for log-scale color mapping)
 *       flow: { min, max, p99 }
 *       n:    { min, max, p99 }
 *       p:    { min, max, p99 }
 *     }
 *   }
 *
 * Usage: pnpm --filter @workspace/scripts run build:reach-data
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// xlsx is published as CommonJS; under Node ESM the namespace import resolves
// to the default export wrapper, so unwrap it here.
import * as XLSXns from "xlsx";
const XLSX: typeof XLSXns = (XLSXns as unknown as { default?: typeof XLSXns }).default ?? XLSXns;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const ATTACHED = join(REPO_ROOT, "attached_assets");
const OUTPUT = join(
  REPO_ROOT,
  "artifacts",
  "shizugawa-dashboard",
  "src",
  "data",
  "reachData.json",
);

function findInputFile(): string {
  const matches = readdirSync(ATTACHED).filter(
    (f) => f.toLowerCase().startsWith("outputrch") && f.toLowerCase().endsWith(".xlsx"),
  );
  if (matches.length === 0) {
    throw new Error(`No outputRch*.xlsx file found in ${ATTACHED}`);
  }
  // Pick the lexicographically last one (newest by suffix timestamp).
  matches.sort();
  return join(ATTACHED, matches[matches.length - 1]);
}

/** Round to 4 significant figures to keep the JSON small without losing
 *  meaningful precision. Storm spikes are 4 orders of magnitude above
 *  baseline so significant figures are the right granularity, not decimals. */
function round4(x: number): number {
  if (!Number.isFinite(x) || x === 0) return 0;
  const sign = Math.sign(x);
  const abs = Math.abs(x);
  const exp = Math.floor(Math.log10(abs));
  const factor = Math.pow(10, 3 - exp); // 4 sig figs
  return sign * Math.round(abs * factor) / factor;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function main() {
  const inputPath = findInputFile();
  console.log(`[buildReachData] reading ${inputPath}`);

  const wb = XLSX.readFile(inputPath, { cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: null,
    raw: true,
  });

  const header = rows[0] as string[];
  const dataRows = rows.slice(1) as Array<[Date, number, number, number, number]>;
  console.log(`[buildReachData] header: ${JSON.stringify(header)}`);
  console.log(`[buildReachData] ${dataRows.length} rows`);

  // Deduplicate dates and sort
  const dateMs = [...new Set(dataRows.map((r) => +r[0]))].sort((a, b) => a - b);
  const startMs = dateMs[0];
  const endMs = dateMs[dateMs.length - 1];
  const dayCount = dateMs.length;
  const startDate = isoDate(new Date(startMs));
  const endDate = isoDate(new Date(endMs));
  console.log(`[buildReachData] date range ${startDate} → ${endDate} (${dayCount} days)`);

  // Validate continuous daily steps
  for (let i = 1; i < dateMs.length; i++) {
    const dt = (dateMs[i] - dateMs[i - 1]) / 86400000;
    if (Math.abs(dt - 1) > 0.01) {
      throw new Error(`Date gap at index ${i}: ${dt} days between ${new Date(dateMs[i-1]).toISOString()} and ${new Date(dateMs[i]).toISOString()}`);
    }
  }

  // Group by reach
  const dateIdxByMs = new Map<number, number>();
  dateMs.forEach((ms, i) => dateIdxByMs.set(ms, i));

  const reachIds = [...new Set(dataRows.map((r) => r[1]))].sort((a, b) => a - b);
  console.log(`[buildReachData] reach IDs: ${reachIds.join(", ")}`);

  const reaches: Record<string, { flow: number[]; n: number[]; p: number[] } | null> = {};
  for (const rch of reachIds) {
    reaches[String(rch)] = {
      flow: new Array(dayCount).fill(0),
      n: new Array(dayCount).fill(0),
      p: new Array(dayCount).fill(0),
    };
  }
  for (const row of dataRows) {
    const [date, rch, flow, n, p] = row;
    const dayIdx = dateIdxByMs.get(+date);
    if (dayIdx === undefined) continue;
    const r = reaches[String(rch)];
    if (!r) continue;
    r.flow[dayIdx] = round4(flow);
    r.n[dayIdx] = round4(n);
    r.p[dayIdx] = round4(p);
  }

  // Detect "no data" reaches: every value is exactly 0 across all 3 years.
  let noDataCount = 0;
  for (const rch of reachIds) {
    const r = reaches[String(rch)]!;
    const sum = r.flow.reduce((a, b) => a + b, 0)
              + r.n.reduce((a, b) => a + b, 0)
              + r.p.reduce((a, b) => a + b, 0);
    if (sum === 0) {
      reaches[String(rch)] = null;
      noDataCount++;
    }
  }
  console.log(`[buildReachData] reaches with data: ${reachIds.length - noDataCount}, no-data: ${noDataCount}`);

  // Compute global bounds + p99 per variable across all reaches with data.
  // p99 is used as the saturation point for log-scale color mapping so that
  // 1-in-100-day storm spikes don't blow out the legend for normal days.
  const collectVar = (varName: "flow" | "n" | "p"): number[] => {
    const all: number[] = [];
    for (const rch of reachIds) {
      const r = reaches[String(rch)];
      if (!r) continue;
      for (const v of r[varName]) all.push(v);
    }
    all.sort((a, b) => a - b);
    return all;
  };
  const stats = (arr: number[]) => ({
    min: arr[0] ?? 0,
    max: arr[arr.length - 1] ?? 0,
    p99: percentile(arr, 0.99),
  });
  const bounds = {
    flow: stats(collectVar("flow")),
    n: stats(collectVar("n")),
    p: stats(collectVar("p")),
  };
  console.log(`[buildReachData] bounds:`, bounds);

  // Year list = unique years present.
  const years = [...new Set(dateMs.map((ms) => new Date(ms).getUTCFullYear()))].sort();

  const out = {
    startDate,
    endDate,
    days: dayCount,
    years,
    reaches,
    bounds,
  };

  mkdirSync(dirname(OUTPUT), { recursive: true });
  // Use plain JSON.stringify (no formatting) for smallest size.
  const json = JSON.stringify(out);
  writeFileSync(OUTPUT, json);
  console.log(`[buildReachData] wrote ${OUTPUT} (${(json.length / 1024).toFixed(1)} KB)`);
}

main();
