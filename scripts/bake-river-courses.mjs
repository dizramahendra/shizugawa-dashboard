/**
 * Bake REAL river centrelines (and bank polygons where they exist) for the
 * map views.
 *
 * v2 — MAP-MATCHING: instead of snapping sparse samples of the hand-drawn
 * course onto the OSM geometry (v1 — which cut meanders between samples and
 * then smoothed the bends away), each drawn course now selects WHICH OSM/MLIT
 * ways it follows, and the output WALKS those ways' own vertex chains — every
 * surveyed bend is preserved verbatim. The drawn course still decides which
 * river/branch is meant; the survey data supplies the geometry.
 *
 * Also fetches river WATER POLYGONS (natural=water + water=river /
 * waterway=riverbank) and bakes the rings that cover each course, so the
 * narrow raster tier can clip to TRUE bank shapes where the data exists
 * (sparse in this region — coverage is reported per river).
 *
 *   node scripts/bake-river-courses.mjs
 *
 * Outputs:
 *   src/lib/realRiverCourses.ts — dense lon/lat centrelines per slug
 *   src/lib/realRiverBanks.ts   — bank polygon rings per slug (where covered)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ── Parse RIVER_PATHS + PATH_RIVER_ID out of the TS sources ───────────────────
function parseObjBlock(src, marker) {
  const s = src.indexOf(marker); const open = src.indexOf("{", s);
  let d = 0, end = -1;
  for (let i = open; i < src.length; i++) { if (src[i] === "{") d++; else if (src[i] === "}") { d--; if (d === 0) { end = i; break; } } }
  return src.slice(open + 1, end);
}
const svgSrc = fs.readFileSync(path.join(ROOT, "src/lib/svgPaths.ts"), "utf8");
const simSrc = fs.readFileSync(path.join(ROOT, "src/lib/simulatedData.ts"), "utf8");
const rpBlock = parseObjBlock(svgSrc, "export const RIVER_PATHS");
const RIVER_PATHS = {}; let m; const re = /(\d+)\s*:\s*(?:"([^"]*)"|`([^`]*)`)/g;
while ((m = re.exec(rpBlock))) RIVER_PATHS[+m[1]] = m[2] ?? m[3];
const idBlock = parseObjBlock(simSrc, "const PATH_RIVER_ID");
const PATH_RIVER_ID = {}; const re2 = /(\d+)\s*:\s*"([^"]+)"/g;
while ((m = re2.exec(idBlock))) PATH_RIVER_ID[+m[1]] = m[2];

// ── SVG sampling (copy of svgSample.ts, absolute M/L/H/V/C) ───────────────────
function tokenize(d){const out=[];const cmdRe=/([A-Za-z])([^A-Za-z]*)/g;let mm;while((mm=cmdRe.exec(d))!==null){const cmd=mm[1];const numRe=/-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;const nums=[];let nm;while((nm=numRe.exec(mm[2]))!==null)nums.push(parseFloat(nm[0]));out.push({cmd,nums});}return out;}
function cubicAt(p0,p1,p2,p3,t){const u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,e=t*t*t;return{x:a*p0.x+b*p1.x+c*p2.x+e*p3.x,y:a*p0.y+b*p1.y+c*p2.y+e*p3.y};}
function cubicLength(p0,p1,p2,p3){let len=0,prev=p0;for(let i=1;i<=16;i++){const pt=cubicAt(p0,p1,p2,p3,i/16);len+=Math.hypot(pt.x-prev.x,pt.y-prev.y);prev=pt;}return len;}
function sampleSvgPath(d,spacing=1){const tokens=tokenize(d);const pts=[];let cur={x:0,y:0};const pushLine=(to)=>{const dist=Math.hypot(to.x-cur.x,to.y-cur.y);const n=Math.max(1,Math.ceil(dist/spacing));for(let i=1;i<=n;i++){const t=i/n;pts.push({x:cur.x+(to.x-cur.x)*t,y:cur.y+(to.y-cur.y)*t});}cur=to;};for(const {cmd,nums} of tokens){switch(cmd){case "M":{cur={x:nums[0],y:nums[1]};pts.push({...cur});for(let i=2;i<nums.length;i+=2)pushLine({x:nums[i],y:nums[i+1]});break;}case "L":{for(let i=0;i<nums.length;i+=2)pushLine({x:nums[i],y:nums[i+1]});break;}case "H":{for(const x of nums)pushLine({x,y:cur.y});break;}case "V":{for(const y of nums)pushLine({x:cur.x,y});break;}case "C":{for(let i=0;i<nums.length;i+=6){const p1={x:nums[i],y:nums[i+1]},p2={x:nums[i+2],y:nums[i+3]},p3={x:nums[i+4],y:nums[i+5]};const len=cubicLength(cur,p1,p2,p3);const n=Math.max(1,Math.ceil(len/spacing));for(let s=1;s<=n;s++)pts.push(cubicAt(cur,p1,p2,p3,s/n));cur=p3;}break;}default:throw new Error("cmd "+cmd);}}return pts;}

// Georeference (same as the app).
const SVG_W = 465, SVG_H = 586;
const svgLonLat = (x, y) => [141.36568 + (x / SVG_W) * 0.16158, 38.59295 + (1 - y / SVG_H) * 0.15515];

// Local metre frame for distance math.
const LAT0 = 38.66;
const KX = 111320 * Math.cos((LAT0 * Math.PI) / 180);
const KY = 110540;
const toM = ([lon, lat]) => [lon * KX, lat * KY];

// ── Overpass fetch (with mirrors) ─────────────────────────────────────────────
const OVERPASS_ENDPOINTS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
async function overpass(query) {
  let lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "shizugawa-dashboard-bake/2.0 (one-off river-course bake)",
          },
          body: "data=" + encodeURIComponent(query),
        });
        if (!res.ok) throw new Error(`Overpass ${res.status} @ ${url}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(String(e));
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  }
  throw lastErr ?? new Error("all Overpass endpoints failed");
}

const BBOX = "38.50,141.25,38.85,141.65";

// ── Match + walk ──────────────────────────────────────────────────────────────
const SNAP_R = 400;      // max match distance (m)
const HYSTERESIS = 0.6;  // distance multiplier for staying on the previous way

// Nearest position on a way to p (metres); returns {d, segIdx, u, lon, lat}.
function nearestOnWay(way, p) {
  let best = { d: Infinity, segIdx: 0, u: 0, lon: 0, lat: 0 };
  for (let i = 0; i < way.pts.length - 1; i++) {
    const [ax, ay] = way.pts[i], [bx, by] = way.pts[i + 1];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy || 1;
    let u = ((p[0] - ax) * dx + (p[1] - ay) * dy) / len2;
    u = Math.max(0, Math.min(1, u));
    const qx = ax + dx * u, qy = ay + dy * u;
    const d = Math.hypot(p[0] - qx, p[1] - qy);
    if (d < best.d) {
      const [alon, alat] = way.ll[i], [blon, blat] = way.ll[i + 1];
      best = { d, segIdx: i, u, lon: alon + (blon - alon) * u, lat: alat + (blat - alat) * u };
    }
  }
  return best;
}

/** Point at (segIdx, u) on a way, in lon/lat. */
function wayPointAt(way, segIdx, u) {
  const [alon, alat] = way.ll[segIdx], [blon, blat] = way.ll[segIdx + 1];
  return [alon + (blon - alon) * u, alat + (blat - alat) * u];
}

/** Walk a way's own vertices from (i0,u0) to (i1,u1), inclusive of the
 *  interpolated endpoints — preserves every surveyed bend. */
function walkWay(way, i0, u0, i1, u1) {
  const out = [wayPointAt(way, i0, u0)];
  if (i0 < i1 || (i0 === i1 && u0 <= u1)) {
    for (let i = i0 + 1; i <= i1; i++) out.push(way.ll[i]);
  } else {
    for (let i = i0; i > i1; i--) out.push(way.ll[i]);
  }
  out.push(wayPointAt(way, i1, u1));
  return out;
}

function pathLenM(ll) {
  let len = 0;
  for (let i = 0; i < ll.length - 1; i++) {
    const a = toM(ll[i]), b = toM(ll[i + 1]);
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Map-match a drawn course onto the way network and emit the walked chain. */
function matchCourse(ways, courseLL) {
  // Pre-filter ways to the course bbox (+ margin).
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const ll of courseLL) { const [x, y] = toM(ll); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const near = ways.filter(w => w.pts.some(([x, y]) => x > minx - 2000 && x < maxx + 2000 && y > miny - 2000 && y < maxy + 2000));

  // 1) Per-sample matching with continuity hysteresis.
  let prevWay = null;
  const matches = courseLL.map(ll => {
    const p = toM(ll);
    let best = null;
    for (const w of near) {
      const n = nearestOnWay(w, p);
      const eff = w === prevWay ? n.d * HYSTERESIS : n.d;
      if (!best || eff < best.eff) best = { eff, rawD: n.d, way: w, segIdx: n.segIdx, u: n.u };
    }
    if (best && best.rawD <= SNAP_R) { prevWay = best.way; return best; }
    prevWay = null;
    return { way: null, ll };
  });

  // 2) Group consecutive same-way matches and WALK the way between entry/exit.
  const out = [];
  const push = (pt) => {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - pt[0]) < 1e-6 && Math.abs(last[1] - pt[1]) < 1e-6) return;
    out.push([+pt[0].toFixed(6), +pt[1].toFixed(6)]);
  };
  let matched = 0;
  let i = 0;
  while (i < matches.length) {
    const cur = matches[i];
    if (!cur.way) { push(cur.ll); i++; continue; }
    let j = i;
    while (j + 1 < matches.length && matches[j + 1].way === cur.way) j++;
    const entry = matches[i], exit = matches[j];
    const chain = walkWay(cur.way, entry.segIdx, entry.u, exit.segIdx, exit.u);
    // Safety: a bad match direction can walk a long detour — compare with the
    // drawn group's own length and fall back to projected points if wildly off.
    const drawnLen = pathLenM(courseLL.slice(i, j + 1));
    if (pathLenM(chain) > Math.max(500, drawnLen * 3)) {
      for (let k = i; k <= j; k++) push(wayPointAt(matches[k].way, matches[k].segIdx, matches[k].u));
    } else {
      for (const pt of chain) push(pt);
    }
    matched += j - i + 1;
    i = j + 1;
  }
  return { pts: out, matchedPct: Math.round((100 * matched) / courseLL.length) };
}

// ── Point-in-ring (lon/lat, ray cast) ────────────────────────────────────────
function inRing(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ── Run ───────────────────────────────────────────────────────────────────────
console.log("fetching waterway centrelines…");
const wjson = await overpass(`[out:json][timeout:120];way[waterway](${BBOX});out geom;`);
const ways = [];
for (const el of wjson.elements ?? []) {
  if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
  ways.push({ id: el.id, pts: el.geometry.map(g => toM([g.lon, g.lat])), ll: el.geometry.map(g => [g.lon, g.lat]) });
}
console.log(`  ${ways.length} ways`);

console.log("fetching river water polygons…");
const pjson = await overpass(
  `[out:json][timeout:120];(way["natural"="water"]["water"="river"](${BBOX});way["waterway"="riverbank"](${BBOX});way["natural"="water"]["water"="stream"](${BBOX}););out geom;`,
);
const rings = [];
for (const el of pjson.elements ?? []) {
  if (el.type !== "way" || !el.geometry || el.geometry.length < 4) continue;
  rings.push(el.geometry.map(g => [g.lon, g.lat]));
}
console.log(`  ${rings.length} river polygon rings`);

const courses = {};
const banks = {};
const stats = [];
for (const [idStr, slug] of Object.entries(PATH_RIVER_ID)) {
  const d = RIVER_PATHS[Number(idStr)];
  if (!d) continue;
  // Dense drawn samples (~2 SVG px ≈ 60 m) purely for MATCHING — the output
  // geometry comes from the ways themselves.
  const dense = sampleSvgPath(d, 2);
  const courseLL = dense.map(p => svgLonLat(p.x, p.y));

  const { pts, matchedPct } = matchCourse(ways, courseLL);
  courses[slug] = pts;

  // Bank polygons covering this course: rings containing ≥2 course points.
  const cover = rings.filter(r => {
    let hits = 0;
    for (const p of pts) if (inRing(p, r)) { hits++; if (hits >= 2) return true; }
    return false;
  });
  if (cover.length) {
    banks[slug] = cover.map(r => r.map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]));
  }
  const inPoly = cover.length ? Math.round((100 * pts.filter(p => cover.some(r => inRing(p, r))).length) / pts.length) : 0;
  stats.push(
    `${slug.padEnd(12)} pts:${String(pts.length).padStart(4)}  matched:${String(matchedPct).padStart(3)}%  bankRings:${String(cover.length).padStart(2)}  courseInPoly:${String(inPoly).padStart(3)}%`,
  );
}
console.log(stats.join("\n"));

const courseBanner = `/**
 * REAL river centrelines for the map views — MAP-MATCHED onto the actual
 * waterway geometry from OpenStreetMap (which for this area carries Japan's
 * MLIT national river data, 河川データ). The hand-drawn SVG course selects
 * WHICH ways each river follows; the output walks those ways' own vertex
 * chains, so every surveyed bend is preserved (no smoothing, no resampling).
 *
 * Generated by scripts/bake-river-courses.mjs — do not edit by hand.
 * MAPS ONLY — the 3D box keeps the hand-drawn SVG as its source of truth.
 * Geometry © OpenStreetMap contributors (ODbL).
 */
export const REAL_RIVER_COURSES: Record<string, [number, number][]> = `;
fs.writeFileSync(path.join(ROOT, "src/lib/realRiverCourses.ts"), courseBanner + JSON.stringify(courses) + ";\n");

const bankBanner = `/**
 * TRUE river bank polygons (lon/lat rings) for the rivers whose channel is
 * mapped as a water polygon in OSM — sparse in this region; most rivers have
 * none, and the raster falls back to the schematic ribbon there. Used by the
 * narrow raster tier to clip cells to the real channel shape where available.
 *
 * Generated by scripts/bake-river-courses.mjs — do not edit by hand.
 * Geometry © OpenStreetMap contributors (ODbL).
 */
export const REAL_RIVER_BANKS: Record<string, [number, number][][]> = `;
fs.writeFileSync(path.join(ROOT, "src/lib/realRiverBanks.ts"), bankBanner + JSON.stringify(banks) + ";\n");

console.log("wrote src/lib/realRiverCourses.ts + src/lib/realRiverBanks.ts");
