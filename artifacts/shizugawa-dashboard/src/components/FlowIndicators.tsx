import { useEffect, useRef } from "react";
import { getBayOceanExchangeIntensity, getSedimentElutionIntensity } from "@/lib/simulatedData";

interface FlowIndicatorsProps {
  week: number;
  showExchange: boolean;
  showElution: boolean;
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function intensityToRgb(intensity: number): string {
  const r = Math.round(lerp(64, 147, intensity));
  const g = Math.round(lerp(144, 210, intensity));
  const b = Math.round(lerp(64, 255, intensity));
  return `rgb(${r},${g},${b})`;
}

function elutionToRgb(intensity: number): string {
  const r = Math.round(lerp(180, 255, intensity));
  const g = Math.round(lerp(200, 230, intensity));
  const b = Math.round(lerp(100, 60, intensity));
  return `rgb(${r},${g},${b})`;
}

export default function FlowIndicators({ week, showExchange, showElution }: FlowIndicatorsProps) {
  const exchangeWrapRef = useRef<HTMLDivElement>(null);
  const exchangeBarRef = useRef<HTMLDivElement>(null);
  const exchangeArrowRefs = useRef<HTMLDivElement[]>([]);
  const exchangeLabelRef = useRef<HTMLDivElement>(null);
  const exchangeBadgeRef = useRef<HTMLDivElement>(null);

  const elutionWrapRef = useRef<HTMLDivElement>(null);
  const elutionGradRef = useRef<HTMLDivElement>(null);
  const elutionArrowRefs = useRef<HTMLDivElement[]>([]);
  const elutionPulseRef = useRef<HTMLDivElement>(null);
  const elutionLabelRef = useRef<HTMLDivElement>(null);

  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const exchangeIntensityRef = useRef(0);
  const elutionIntensityRef = useRef(0);

  useEffect(() => {
    exchangeIntensityRef.current = getBayOceanExchangeIntensity(week);
    elutionIntensityRef.current = getSedimentElutionIntensity(week);
  }, [week]);

  useEffect(() => {
    let lastTs = performance.now();

    function tick(ts: number) {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      phaseRef.current += dt * 1.4;

      const pulse = (Math.sin(phaseRef.current * Math.PI * 2) + 1) / 2;
      const slowPulse = (Math.sin(phaseRef.current * Math.PI * 1.1) + 1) / 2;

      const eI = exchangeIntensityRef.current;
      const sI = elutionIntensityRef.current;

      // ── Exchange indicator ──────────────────────────────────
      if (exchangeWrapRef.current) {
        exchangeWrapRef.current.style.opacity = showExchange ? "1" : "0";
      }
      if (showExchange) {
        const color = intensityToRgb(eI);
        const glow = Math.round(lerp(0, 25, eI * pulse));

        exchangeArrowRefs.current.forEach((el, i) => {
          if (!el) return;
          const delay = i * 0.28;
          const localPulse = (Math.sin((phaseRef.current - delay) * Math.PI * 2) + 1) / 2;
          el.style.opacity = String(Math.max(0.15, 0.2 + localPulse * 0.7 * eI));
          el.style.color = color;
          el.style.textShadow = `0 0 ${glow}px ${color}`;
          el.style.transform = `translateX(${localPulse * 4 * eI}px)`;
        });

        if (exchangeBarRef.current) {
          const arrowOpacity = 0.35 + pulse * 0.55 * eI;
          exchangeBarRef.current.style.opacity = String(0.25 + arrowOpacity * 0.5);
          exchangeBarRef.current.style.background =
            `linear-gradient(to right, transparent, ${color}88, ${color})`;
        }

        if (exchangeLabelRef.current) {
          exchangeLabelRef.current.style.color = intensityToRgb(eI * 0.8 + 0.1);
        }

        if (exchangeBadgeRef.current) {
          exchangeBadgeRef.current.style.background = color;
          exchangeBadgeRef.current.style.opacity = String(0.8 + pulse * 0.2);
        }
      }

      // ── Elution indicator ───────────────────────────────────
      if (elutionWrapRef.current) {
        elutionWrapRef.current.style.opacity = showElution ? "1" : "0";
      }
      if (showElution) {
        const elutionActive = sI > 0.35;
        const eColor = elutionToRgb(sI);

        if (elutionGradRef.current) {
          const gradOpacity = elutionActive ? 0.18 + slowPulse * 0.28 * sI : 0.06 + slowPulse * 0.06;
          elutionGradRef.current.style.opacity = String(gradOpacity);
          elutionGradRef.current.style.background =
            `linear-gradient(to top, ${eColor}cc 0%, ${eColor}55 40%, transparent 100%)`;
        }

        elutionArrowRefs.current.forEach((el, i) => {
          if (!el) return;
          const delay = i * 0.35;
          const localPulse = (Math.sin((phaseRef.current * 0.8 - delay) * Math.PI * 2) + 1) / 2;
          el.style.opacity = elutionActive
            ? String(0.25 + localPulse * 0.7 * sI)
            : String(0.08 + localPulse * 0.08);
          el.style.transform = `translateY(${-localPulse * 6 * Math.max(0.3, sI)}px)`;
          el.style.color = eColor;
        });

        if (elutionPulseRef.current) {
          const pScale = elutionActive ? 0.92 + slowPulse * 0.16 * sI : 1;
          elutionPulseRef.current.style.transform = `scaleX(${pScale})`;
          elutionPulseRef.current.style.opacity = elutionActive ? String(0.5 + slowPulse * 0.35) : "0.2";
          elutionPulseRef.current.style.color = eColor;
        }

        if (elutionLabelRef.current) {
          elutionLabelRef.current.style.opacity = String(elutionActive ? 0.85 + slowPulse * 0.15 : 0.45);
          elutionLabelRef.current.style.color = elutionToRgb(sI * 0.7 + 0.2);
        }
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [showExchange, showElution]);

  return (
    <>
      {/* Bay–Ocean Exchange Indicator — right edge of viewport */}
      <div
        ref={exchangeWrapRef}
        className="pointer-events-none absolute right-0 top-0 h-full flex flex-col items-end justify-center"
        style={{ opacity: 0, transition: "opacity 0.4s ease", width: 110, zIndex: 10 }}
      >
        <div
          ref={exchangeBarRef}
          className="absolute right-0 top-0 h-full"
          style={{ width: 70, transition: "opacity 0.3s" }}
        />
        <div className="relative flex flex-col items-end gap-2 pr-3 z-10">
          <div
            ref={exchangeLabelRef}
            className="text-[9px] font-semibold tracking-wider uppercase text-right mb-1"
            style={{ letterSpacing: "0.1em", textShadow: "0 1px 4px #0008", transition: "color 0.3s" }}
          >
            Bay–Ocean<br />Exchange
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              ref={(el) => { if (el) exchangeArrowRefs.current[i] = el; }}
              className="flex items-center gap-0.5 text-lg font-bold"
              style={{ transition: "opacity 0.15s, color 0.3s, transform 0.15s, text-shadow 0.3s" }}
            >
              →
            </div>
          ))}
          <div
            ref={exchangeBadgeRef}
            className="mt-1 text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full"
            style={{ letterSpacing: "0.05em", transition: "background 0.3s, opacity 0.3s" }}
          >
            ACTIVE
          </div>
        </div>
      </div>

      {/* Sediment Elution Indicator — bottom of viewport */}
      <div
        ref={elutionWrapRef}
        className="pointer-events-none absolute bottom-0 left-0 w-full"
        style={{ opacity: 0, transition: "opacity 0.4s ease", height: 90, zIndex: 10 }}
      >
        <div
          ref={elutionGradRef}
          className="absolute bottom-0 left-0 w-full h-full"
          style={{ transition: "opacity 0.3s" }}
        />
        <div className="relative h-full flex flex-col items-center justify-end pb-2 z-10 gap-1">
          <div className="flex gap-5 items-end">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                ref={(el) => { if (el) elutionArrowRefs.current[i] = el; }}
                className="text-base font-bold"
                style={{ transition: "opacity 0.2s, color 0.3s, transform 0.2s" }}
              >
                ↑
              </div>
            ))}
          </div>
          <div
            ref={elutionPulseRef}
            className="w-24 h-0.5 rounded-full bg-current"
            style={{ transition: "transform 0.3s, opacity 0.3s" }}
          />
          <div
            ref={elutionLabelRef}
            className="text-[9px] font-semibold tracking-widest uppercase"
            style={{ letterSpacing: "0.12em", textShadow: "0 1px 4px #0008", transition: "opacity 0.3s, color 0.3s" }}
          >
            Sediment Elution
          </div>
        </div>
      </div>
    </>
  );
}
