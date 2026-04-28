import { useCallback, useMemo, useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import TopNav from "@/components/TopNav";
import MapLibreMap from "@/components/MapLibreMap";
import SubBasinComparisonPanel from "@/components/SubBasinComparisonPanel";
import {
  SUB_BASIN_COLORS,
  SUB_BASIN_META,
  SUB_BASIN_MEASURES,
  type SubBasinMeasureId,
} from "@/lib/simulatedData";

/**
 * Sub-basin tab — multi-select 1–25 sub-basins on the map and compare their
 * five primary environmental indicators side-by-side.  See
 * `SubBasinComparisonPanel` for the visualisation contract.
 *
 * URL state:
 *   ?ids=1,5,20      selected sub-basin ids (max 25, deduped)
 *   ?agg=1           aggregate (regional sum) view
 *   ?m=afforestation decarbonization measure (aggregate-only)
 *   ?view=combined   single normalised bar chart (all 5 indicators on one axis)
 *   ?view=radar      radar polygon view
 */

type AggregateView = "bars" | "combined" | "radar";

const VALID_MEASURE_IDS = new Set<string>(SUB_BASIN_MEASURES.map(m => m.id));

export default function SubBasinPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Initial state from URL ──
  // Defensively dedupe ids (preserving first-seen order) and clamp to 25 so
  // a malformed deep-link like ?ids=1,1,1,2,... cannot inflate aggregate
  // totals or render duplicate chips/charts.
  const initIds = useMemo(() => {
    const raw = searchParams.get("ids");
    if (!raw) return [] as number[];
    const valid = new Set(SUB_BASIN_META.map(b => b.id));
    const seen  = new Set<number>();
    const out: number[] = [];
    for (const tok of raw.split(",")) {
      const n = Number(tok.trim());
      if (!Number.isFinite(n) || !valid.has(n) || seen.has(n)) continue;
      seen.add(n);
      out.push(n);
      if (out.length >= 25) break;
    }
    return out;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const initMeasure: SubBasinMeasureId = useMemo(() => {
    const raw = searchParams.get("m");
    if (raw && VALID_MEASURE_IDS.has(raw)) return raw as SubBasinMeasureId;
    return "none";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const initAggregateView: AggregateView = useMemo(() => {
    const v = searchParams.get("view");
    if (v === "radar")    return "radar";
    if (v === "combined") return "combined";
    return "bars";
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [selectedIds, setSelectedIds] = useState<number[]>(initIds);
  const [aggregate, setAggregate]     = useState<boolean>(searchParams.get("agg") === "1");
  const [measureId, setMeasureId]     = useState<SubBasinMeasureId>(initMeasure);
  const [aggregateView, setAggregateView] = useState<AggregateView>(initAggregateView);

  // Stable id→color mapping based on selection order, so a basin keeps the
  // same colour on the map and in every chart bar even as others are added.
  const colorOf = useMemo(() => {
    const map: Record<number, string> = {};
    selectedIds.forEach((id, idx) => {
      map[id] = SUB_BASIN_COLORS[idx % SUB_BASIN_COLORS.length];
    });
    return map;
  }, [selectedIds]);

  const colorFor = useCallback(
    (id: number) => colorOf[id] ?? SUB_BASIN_COLORS[0],
    [colorOf],
  );

  // Mirror state → URL
  useEffect(() => {
    setSearchParams(p => {
      const next = new URLSearchParams(p);
      if (selectedIds.length > 0) next.set("ids", selectedIds.join(","));
      else next.delete("ids");
      if (aggregate) next.set("agg", "1"); else next.delete("agg");
      if (measureId !== "none") next.set("m", measureId); else next.delete("m");
      if (aggregateView !== "bars") next.set("view", aggregateView); else next.delete("view");
      return next;
    }, { replace: true });
  }, [selectedIds, aggregate, measureId, aggregateView, setSearchParams]);

  // ── Selection handlers ──
  const handleToggle = useCallback((id: number) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 25)  return prev;
      return [...prev, id];
    });
  }, []);

  const handleRemove = useCallback((id: number) => {
    setSelectedIds(prev => prev.filter(x => x !== id));
  }, []);

  const handleClear = useCallback(() => {
    setSelectedIds([]);
    setAggregate(false);
    setMeasureId("none");
    setAggregateView("bars");
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIds(SUB_BASIN_META.map(b => b.id));
  }, []);

  // Turning aggregate OFF resets the aggregate-only sub-state so coming
  // back to it is a clean default (no measure, bars).
  const handleSetAggregate = useCallback((v: boolean) => {
    setAggregate(v);
    if (!v) {
      setMeasureId("none");
      setAggregateView("bars");
    }
  }, []);

  // No-op river / ocean handlers (rivers + ocean are non-interactive in
  // sub-basin mode — these just satisfy the MapLibreMap props contract).
  const noopRiver = useCallback((_id: string | null) => { /* sub-basin mode */ }, []);
  const noopOcean = useCallback(() => { /* sub-basin mode */ }, []);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-background">
      <TopNav />

      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left: map + caption strip */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Compact toolbar — caption + quick stats */}
          <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-white border-b border-border">
            <span className="text-xs font-semibold text-foreground">
              Sub-basin Comparison
            </span>
            <span className="text-[10px] text-muted-foreground">
              Click polygons to compare · max 25
            </span>
            <div className="ml-auto flex items-center gap-3 text-[10.5px]">
              <span className="text-muted-foreground">
                Selected · <span className="font-mono text-foreground">{selectedIds.length}</span>
              </span>
              {selectedIds.length > 0 && (
                <span className="text-muted-foreground">
                  Mode ·{" "}
                  <span className="font-medium text-foreground">
                    {selectedIds.length === 1
                      ? "Single"
                      : aggregate ? "Aggregate" : "Compare"}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden relative">
            <MapLibreMap
              week={0}
              variableId="nitrogen"
              selectedRiver={null}
              onSelectRiver={noopRiver}
              onSelectOcean={noopOcean}
              subBasinMode
              selectedSubBasins={selectedIds}
              subBasinColors={colorOf}
              onToggleSubBasin={handleToggle}
            />

            {/* Hint overlay when nothing selected */}
            {selectedIds.length === 0 && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/95 backdrop-blur-sm border border-border rounded-md px-3 py-1.5 shadow-sm pointer-events-none">
                <span className="text-[11px] text-foreground">
                  <span className="font-semibold">Tip:</span>{" "}
                  Click any sub-basin polygon to start comparing
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Right: comparison panel */}
        <div className="w-[360px] flex-shrink-0 border-l border-border flex flex-col overflow-hidden">
          <SubBasinComparisonPanel
            selectedIds={selectedIds}
            colorFor={colorFor}
            aggregate={aggregate}
            measureId={measureId}
            aggregateView={aggregateView}
            onSetAggregate={handleSetAggregate}
            onSetMeasure={setMeasureId}
            onSetAggregateView={setAggregateView}
            onRemove={handleRemove}
            onClear={handleClear}
            onSelectAll={handleSelectAll}
            onSelectAllDeselect={handleClear}
          />
        </div>
      </div>
    </div>
  );
}
