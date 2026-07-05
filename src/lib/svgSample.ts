// ── DOM-free SVG path sampler ────────────────────────────────────────────────
// Parses an ABSOLUTE SVG path string and samples it into a dense polyline of
// points, evaluating cubic béziers analytically. This runs at module load
// (pure JS, no `document` / `getPointAtLength`), so it can feed synchronous
// exports like RIVER_CELLS.
//
// Supported commands (absolute only, as used by RIVER_PATHS in svgPaths.ts):
//   M  moveto           (x y)+
//   L  lineto           (x y)+
//   H  horizontal line  (x)+
//   V  vertical line    (y)+
//   C  cubic bézier     (x1 y1 x2 y2 x y)+
// Any other command (relative m/l/…, arcs A, quadratics Q/T, S, Z) throws a
// clear error so an unexpected path shape is caught loudly rather than
// silently mis-sampled.

export interface Pt {
  x: number;
  y: number;
}

// Split a path string into [command letter, ...numeric args] tokens.
function tokenize(d: string): Array<{ cmd: string; nums: number[] }> {
  const out: Array<{ cmd: string; nums: number[] }> = [];
  // Match a command letter followed by its run of numbers (incl. exponents /
  // signed / decimal). Numbers may be separated by spaces, commas, or a leading
  // minus sign with no separator.
  const cmdRe = /([A-Za-z])([^A-Za-z]*)/g;
  let m: RegExpExecArray | null;
  while ((m = cmdRe.exec(d)) !== null) {
    const cmd = m[1];
    const numRe = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
    const nums: number[] = [];
    let nm: RegExpExecArray | null;
    while ((nm = numRe.exec(m[2])) !== null) nums.push(parseFloat(nm[0]));
    out.push({ cmd, nums });
  }
  return out;
}

function cubicAt(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const e = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + e * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + e * p3.y,
  };
}

function cubicLength(p0: Pt, p1: Pt, p2: Pt, p3: Pt): number {
  // Coarse polyline estimate — good enough to pick a sample count.
  let len = 0;
  let prev = p0;
  const N = 16;
  for (let i = 1; i <= N; i++) {
    const pt = cubicAt(p0, p1, p2, p3, i / N);
    len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
    prev = pt;
  }
  return len;
}

/**
 * Sample an absolute-command SVG path into a dense array of points, at roughly
 * `spacing` SVG units between consecutive points (default ~1px). Straight
 * segments (L/H/V) are interpolated; cubic béziers (C) are evaluated
 * analytically. Consecutive M/L/… vertices are always retained.
 */
export function sampleSvgPath(d: string, spacing = 1): Pt[] {
  const tokens = tokenize(d);
  const pts: Pt[] = [];
  let cur: Pt = { x: 0, y: 0 };
  let started = false;

  const pushLine = (to: Pt) => {
    const dist = Math.hypot(to.x - cur.x, to.y - cur.y);
    const n = Math.max(1, Math.ceil(dist / spacing));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      pts.push({ x: cur.x + (to.x - cur.x) * t, y: cur.y + (to.y - cur.y) * t });
    }
    cur = to;
  };

  for (const { cmd, nums } of tokens) {
    switch (cmd) {
      case "M": {
        if (nums.length < 2 || nums.length % 2 !== 0)
          throw new Error(`sampleSvgPath: bad M args (${nums.length})`);
        // First pair = moveto; subsequent pairs = implicit linetos.
        cur = { x: nums[0], y: nums[1] };
        if (!started) {
          pts.push({ ...cur });
          started = true;
        } else {
          pts.push({ ...cur });
        }
        for (let i = 2; i < nums.length; i += 2) {
          pushLine({ x: nums[i], y: nums[i + 1] });
        }
        break;
      }
      case "L": {
        if (nums.length < 2 || nums.length % 2 !== 0)
          throw new Error(`sampleSvgPath: bad L args (${nums.length})`);
        for (let i = 0; i < nums.length; i += 2) {
          pushLine({ x: nums[i], y: nums[i + 1] });
        }
        break;
      }
      case "H": {
        if (nums.length < 1)
          throw new Error(`sampleSvgPath: bad H args (${nums.length})`);
        for (const x of nums) pushLine({ x, y: cur.y });
        break;
      }
      case "V": {
        if (nums.length < 1)
          throw new Error(`sampleSvgPath: bad V args (${nums.length})`);
        for (const y of nums) pushLine({ x: cur.x, y });
        break;
      }
      case "C": {
        if (nums.length < 6 || nums.length % 6 !== 0)
          throw new Error(`sampleSvgPath: bad C args (${nums.length})`);
        for (let i = 0; i < nums.length; i += 6) {
          const p1 = { x: nums[i], y: nums[i + 1] };
          const p2 = { x: nums[i + 2], y: nums[i + 3] };
          const p3 = { x: nums[i + 4], y: nums[i + 5] };
          const len = cubicLength(cur, p1, p2, p3);
          const n = Math.max(1, Math.ceil(len / spacing));
          for (let s = 1; s <= n; s++) {
            pts.push(cubicAt(cur, p1, p2, p3, s / n));
          }
          cur = p3;
        }
        break;
      }
      default:
        throw new Error(
          `sampleSvgPath: unsupported command "${cmd}" (only absolute M L H V C are supported)`,
        );
    }
  }
  return pts;
}
