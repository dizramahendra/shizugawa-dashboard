import { DEPTH_REAL_M } from "@/lib/simulatedData";

// Approx bottom depth (m) of each of the 8 water-column layers, paired with
// DEPTH_REAL_M (their tops) to render range labels like "0–2 m", "2–5 m".
const DEPTH_REAL_BOT = [2, 5, 10, 18, 30, 47, 69, 90];

/** Human label for a depth-layer index: "0–2 m", "2–5 m", etc. */
export function depthLabel(d: number): string {
  return `${DEPTH_REAL_M[d]}–${DEPTH_REAL_BOT[d]} m`;
}
