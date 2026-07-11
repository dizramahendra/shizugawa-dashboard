/**
 * Bake REAL river centrelines for the map views.
 *
 * For each modelled river, takes the hand-drawn SVG course (georeferenced) and
 * SNAPS it onto the real waterway geometry from OpenStreetMap (which for this
 * area carries Japan's MLIT national river data, 河川データ). The drawn course
 * keeps deciding WHICH river/branch is meant — the survey data supplies the
 * accurate line. Points with no waterway nearby keep their drawn position.
 *
 * One-off script (node >= 18): fetches Overpass, writes
 * src/lib/realRiverCourses.ts with the baked lon/lat polylines.
 *
 *   node scripts/bake-river-courses.mjs
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

// ── Fetch OSM waterways (with geometry) via Overpass ──────────────────────────
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const QUERY = `[out:json][timeout:120];way[waterway](38.50,141.25,38.85,141.65);out geom;`;

async function fetchWaterways() {
  let json = null, lastErr = null;
  for (const url of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2 && !json; attempt++) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/json",
            "User-Agent": "shizugawa-dashboard-bake/1.0 (one-off river-course bake)",
          },
          body: "data=" + encodeURIComponent(QUERY),
        });
        if (!res.ok) throw new Error(`Overpass ${res.status} @ ${url}`);
        json = await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(String(e));
        await new Promise(r => setTimeout(r, 3000));
      }
    }
    if (json) break;
  }
  if (!json) throw lastErr ?? new Error("all Overpass endpoints failed");
  const ways = [];
  for (const el of json.elements ?? []) {
    if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
    ways.push({ id: el.id, pts: el.geometry.map(g => toM([g.lon, g.lat])), ll: el.geometry.map(g => [g.lon, g.lat]) });
  }
  return ways;
}

// Nearest point on a way to p (metres); returns {d, lon, lat}.
function nearestOnWay(way, p) {
  let best = { d: Infinity, lon: 0, lat: 0 };
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
      best = { d, lon: alon + (blon - alon) * u, lat: alat + (blat - alat) * u };
    }
  }
  return best;
}

const SNAP_R = 400;      // max snap distance (m)
const HYSTERESIS = 0.6;  // distance multiplier for staying on the previous way
const N_SAMPLES = 160;   // course sample density

function snapCourse(ways, courseLL) {
  // Pre-filter ways to the course's bbox (+ margin) for speed.
  let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
  for (const ll of courseLL) { const [x, y] = toM(ll); minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const near = ways.filter(w => w.pts.some(([x, y]) => x > minx - 2000 && x < maxx + 2000 && y > miny - 2000 && y < maxy + 2000));

  let prevWay = null;
  let snapped = 0; let shiftSum = 0;
  const out = courseLL.map(ll => {
    const p = toM(ll);
    let best = { d: Infinity, lon: ll[0], lat: ll[1], way: null };
    for (const w of near) {
      const n = nearestOnWay(w, p);
      // Hysteresis: prefer continuing along the way we snapped to previously,
      // so the line doesn't zigzag between parallel branches at confluences.
      const eff = w === prevWay ? n.d * HYSTERESIS : n.d;
      if (eff < best.d) best = { d: eff, lon: n.lon, lat: n.lat, way: w, rawD: n.d };
    }
    if (best.way && best.rawD <= SNAP_R) {
      prevWay = best.way;
      snapped++; shiftSum += best.rawD;
      return [best.lon, best.lat];
    }
    prevWay = null;
    return ll; // no waterway nearby — keep the drawn position
  });

  // Light smoothing (moving average, window 3) to remove snap steps.
  const sm = out.map((p, i) => {
    if (i === 0 || i === out.length - 1) return p;
    return [(out[i - 1][0] + p[0] + out[i + 1][0]) / 3, (out[i - 1][1] + p[1] + out[i + 1][1]) / 3];
  });
  return { pts: sm, snapped, meanShift: snapped ? shiftSum / snapped : 0 };
}

const ways = await fetchWaterways();
console.log(`Overpass: ${ways.length} waterway ways with geometry`);

const out = {};
const stats = [];
for (const [idStr, slug] of Object.entries(PATH_RIVER_ID)) {
  const d = RIVER_PATHS[Number(idStr)];
  if (!d) continue;
  const dense = sampleSvgPath(d, 1);
  const step = Math.max(1, Math.floor(dense.length / N_SAMPLES));
  const courseLL = [];
  for (let i = 0; i < dense.length; i += step) courseLL.push(svgLonLat(dense[i].x, dense[i].y));
  const last = dense[dense.length - 1];
  courseLL.push(svgLonLat(last.x, last.y));

  const { pts, snapped, meanShift } = snapCourse(ways, courseLL);
  out[slug] = pts.map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)]);
  stats.push(`${slug.padEnd(12)} pts:${String(pts.length).padStart(4)}  snapped:${String(Math.round((100 * snapped) / courseLL.length)).padStart(3)}%  meanShift:${Math.round(meanShift)}m`);
}
console.log(stats.join("\n"));

const banner = `/**
 * REAL river centrelines for the map views — the hand-drawn SVG courses
 * snapped onto the actual waterway geometry from OpenStreetMap (which for this
 * area carries Japan's MLIT national river data, 河川データ 2006).
 *
 * Generated by scripts/bake-river-courses.mjs — do not edit by hand; re-run
 * the script to re-bake. The drawn course still decides WHICH river/branch is
 * meant (snap radius ${SNAP_R} m with continuity hysteresis); the survey data
 * supplies the accurate line. Only the MAP views consume this — the 3D box
 * keeps the hand-drawn SVG as its source of truth.
 *
 * Geometry © OpenStreetMap contributors (ODbL).
 */
export const REAL_RIVER_COURSES: Record<string, [number, number][]> = `;

fs.writeFileSync(
  path.join(ROOT, "src/lib/realRiverCourses.ts"),
  banner + JSON.stringify(out) + ";\n",
);
console.log("wrote src/lib/realRiverCourses.ts");
