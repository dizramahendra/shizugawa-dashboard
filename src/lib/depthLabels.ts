import { DEPTH_REAL_M, DEPTH_REAL_BOT } from "@/lib/simulatedData";

// Range labels like "0–2 m", "2–5 m" from each layer's real top/bottom depths.
// Both arrays are generated in simulatedData at the active DEPTH_SUBDIV, so this
// stays correct at any layer count. Rounded because subdivided layers land on
// fractional metres (e.g. 3.5 m).
export function depthLabel(d: number): string {
  return `${Math.round(DEPTH_REAL_M[d])}–${Math.round(DEPTH_REAL_BOT[d])} m`;
}
