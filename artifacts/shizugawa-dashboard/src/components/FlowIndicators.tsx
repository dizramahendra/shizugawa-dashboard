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
  const b = Math.round(lerp(213, 255, intensity));
  return `rgb(${r},${g},${b})`;
}

function elutionToRgb(intensity: number): string {
  const r = Math.round(lerp(180, 255, intensity));
  const g = Math.round(lerp(200, 230, intensity));
  const b = Math.round(lerp(100, 60, intensity));
  return `rgb(${r},${g},${b})`;
}

export default function FlowIndicators({ week, showExchange, showElution }: FlowIndicatorsProps) {
  const exchangeRef = useRef<HTMLDivElement>(null);
  const elutionRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const phaseRef = useRef(0);
  const exchangeIntensityRef = useRef(0);
  const elutionIntensityRef = useRef(0);
  const prevWeekRef = useRef(-1);

  useEffect(() => {
    if (week !== prevWeekRef.current) {
      prevWeekRef.current = week;
      exchangeIntensityRef.current = getBayOceanExchangeIntensity(week);
      elutionIntensityRef.current = getSedimentElutionIntensity(week);
    }

    let lastTs = performance.now();

    function tick(ts: number) {
      const dt = (ts - lastTs) / 1000;
      lastTs = ts;
      phaseRef.current += dt * 1.4;

      const pulse = (Math.sin(phaseRef.current * Math.PI * 2) + 1) / 2;
      const slowPulse = (Math.sin(phaseRef.current * Math.PI * 1.1) + 1) / 2;

      const eI = exchangeIntensityRef.current;
      const sI = elutionIntensityRef.current;

      if (exchangeRef.current && showExchange) {
        const arrowOpacity = 0.35 + pulse * 0.55 * eI;
        const glow = Math.round(lerp(0, 25, eI * pulse));
        const color = intensityToRgb(eI);
        exchangeRef.current.style.opacity = "1";
        const arrows = exchangeRef.current.querySelectorAll<HTMLElement>(".exchange-arrow");
        arrows.forEach((el, i) => {
          const delay = i * 0.28;
          const localPulse = (Math.sin((phaseRef.current - delay) * Math.PI * 2) + 1) / 2;
          el.style.opacity = String(Math.max(0.15, 0.2 + localPulse * 0.7 * eI));
          el.style.color = color;
          el.style.textShadow = `0 0 ${glow}px ${color}`;
          el.style.transform = `translateX(${localPulse * 4 * eI}px)`;
        });
        const bar = exchangeRef.current.querySelector<HTMLElement>(".exchange-bar");
        if (bar) {
          bar.style.opacity = String(0.25 + arrowOpacity * 0.5);
          bar.style.background = `linear-gradient(to right, transparent, ${color}88, ${color})`;
        }
        const label = exchangeRef.current.querySelector<HTMLElement>(".exchange-label");
        if (label) {
          label.style.color = intensityToRgb(eI * 0.8 + 0.1);
        }
        const badge = exchangeRef.current.querySelector<HTMLElement>(".exchange-badge");
        if (badge) {
          badge.style.background = color;
          badge.style.opacity = String(0.8 + pulse * 0.2);
        }
      } else if (exchangeRef.current) {
        exchangeRef.current.style.opacity = "0";
      }

      if (elutionRef.current && showElution) {
        const elutionActive = sI > 0.35;
        elutionRef.current.style.opacity = "1";
        const grad = elutionRef.current.querySelector<HTMLElement>(".elution-grad");
        if (grad) {
          const gradOpacity = elutionActive ? 0.18 + slowPulse * 0.28 * sI : 0.06 + slowPulse * 0.06;
          grad.style.opacity = String(gradOpacity);
          const eColor = elutionToRgb(sI);
          grad.style.background = `linear-gradient(to top, ${eColor}cc 0%, ${eColor}55 40%, transparent 100%)`;
        }
        const upArrows = elutionRef.current.querySelectorAll<HTMLElement>(".elution-arrow");
        upArrows.forEach((el, i) => {
          const delay = i * 0.35;
          const localPulse = (Math.sin((phaseRef.current * 0.8 - delay) * Math.PI * 2) + 1) / 2;
          el.style.opacity = elutionActive ? String(0.25 + localPulse * 0.7 * sI) : String(0.08 + localPulse * 0.08);
          el.style.transform = `translateY(${-localPulse * 6 * Math.max(0.3, sI)}px)`;
          el.style.color = elutionToRgb(sI);
        });
        const elLabel = elutionRef.current.querySelector<HTMLElement>(".elution-label");
        if (elLabel) {
          elLabel.style.opacity = String(elutionActive ? 0.85 + slowPulse * 0.15 : 0.45);
          elLabel.style.color = elutionToRgb(sI * 0.7 + 0.2);
        }
        const pulse2 = elutionRef.current.querySelector<HTMLElement>(".elution-pulse");
        if (pulse2) {
          const pScale = elutionActive ? 0.92 + slowPulse * 0.16 * sI : 1;
          pulse2.style.transform = `scaleX(${pScale})`;
          pulse2.style.opacity = elutionActive ? String(0.5 + slowPulse * 0.35) : "0.2";
        }
      } else if (elutionRef.current) {
        elutionRef.current.style.opacity = "0";
      }

      animFrameRef.current = requestAnimationFrame(tick);
    }

    animFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [week, showExchange, showElution]);

  return (
    <>
      {/* Bay–Ocean Exchange Indicator — right edge of viewport */}
      <div
        ref={exchangeRef}
        className="pointer-events-none absolute right-0 top-0 h-full flex flex-col items-end justify-center"
        style={{ opacity: 0, transition: "opacity 0.4s ease", width: 110, zIndex: 10 }}
      >
        <div
          className="exchange-bar absolute right-0 top-0 h-full"
          style={{ width: 70, transition: "opacity 0.3s" }}
        />
        <div className="relative flex flex-col items-end gap-2 pr-3 z-10">
          <div
            className="exchange-label text-[9px] font-semibold tracking-wider uppercase text-right mb-1"
            style={{ letterSpacing: "0.1em", textShadow: "0 1px 4px #0008", transition: "color 0.3s" }}
          >
            Bay–Ocean<br />Exchange
          </div>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="exchange-arrow flex items-center gap-0.5 text-lg font-bold"
              style={{ transition: "opacity 0.15s, color 0.3s, transform 0.15s, text-shadow 0.3s" }}
            >
              →
            </div>
          ))}
          <div
            className="exchange-badge mt-1 text-[8px] font-bold text-white px-1.5 py-0.5 rounded-full"
            style={{ letterSpacing: "0.05em", transition: "background 0.3s, opacity 0.3s" }}
          >
            ACTIVE
          </div>
        </div>
      </div>

      {/* Sediment Elution Indicator — bottom of viewport */}
      <div
        ref={elutionRef}
        className="pointer-events-none absolute bottom-0 left-0 w-full"
        style={{ opacity: 0, transition: "opacity 0.4s ease", height: 90, zIndex: 10 }}
      >
        <div
          className="elution-grad absolute bottom-0 left-0 w-full h-full"
          style={{ transition: "opacity 0.3s" }}
        />
        <div className="relative h-full flex flex-col items-center justify-end pb-2 z-10 gap-1">
          <div className="flex gap-5 items-end">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="elution-arrow text-base font-bold"
                style={{ transition: "opacity 0.2s, color 0.3s, transform 0.2s" }}
              >
                ↑
              </div>
            ))}
          </div>
          <div
            className="elution-pulse w-24 h-0.5 rounded-full bg-current"
            style={{ transition: "transform 0.3s, opacity 0.3s" }}
          />
          <div
            className="elution-label text-[9px] font-semibold tracking-widest uppercase"
            style={{ letterSpacing: "0.12em", textShadow: "0 1px 4px #0008", transition: "opacity 0.3s, color 0.3s" }}
          >
            Sediment Elution
          </div>
        </div>
      </div>
    </>
  );
}
