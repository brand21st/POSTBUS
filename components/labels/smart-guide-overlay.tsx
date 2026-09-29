import { formatMmFromPt, type SmartOverlay } from "@/modules/labels/multi-up/smart-guides";

function MeasureLabel({ left, top, text }: { left: number; top: number; text: string }) {
  return (
    <span
      className="absolute z-20 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-white/90 px-1 py-px text-[10px] font-medium tabular-nums text-fuchsia-700 shadow-sm ring-1 ring-fuchsia-200/80"
      style={{ left, top }}
    >
      {text}
    </span>
  );
}

export function SmartGuideOverlay({ overlay, scale }: { overlay: SmartOverlay; scale: number }) {
  const { bbox, guides, paperGaps, neighborGaps } = overlay;
  const midX = (bbox.xPt + bbox.widthPt / 2) * scale;
  const midY = (bbox.yPt + bbox.heightPt / 2) * scale;
  const right = bbox.xPt + bbox.widthPt;
  const bottom = bbox.yPt + bbox.heightPt;

  return (
    <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden" aria-hidden>
      {guides.map((guide, index) => {
        const start = Math.min(guide.from, guide.to) * scale;
        const span = Math.abs(guide.to - guide.from) * scale;
        const vertical = guide.axis === "x";
        return (
          <div
            key={`${guide.kind}-${guide.axis}-${guide.at}-${index}`}
            className="absolute bg-fuchsia-500/90"
            style={
              vertical
                ? { left: guide.at * scale, top: start, width: 1, height: span }
                : { left: start, top: guide.at * scale, width: span, height: 1 }
            }
          />
        );
      })}

      {paperGaps.leftPt >= -0.05 ? (
        <>
          <div
            className="absolute bg-fuchsia-400/70"
            style={{ left: 0, top: midY, width: Math.max(0, paperGaps.leftPt) * scale, height: 1 }}
          />
          <MeasureLabel left={Math.max(0, paperGaps.leftPt) * scale * 0.5} top={midY} text={formatMmFromPt(paperGaps.leftPt)} />
        </>
      ) : null}

      {paperGaps.rightPt >= -0.05 ? (
        <>
          <div
            className="absolute bg-fuchsia-400/70"
            style={{ left: right * scale, top: midY, width: Math.max(0, paperGaps.rightPt) * scale, height: 1 }}
          />
          <MeasureLabel left={(right + Math.max(0, paperGaps.rightPt) / 2) * scale} top={midY} text={formatMmFromPt(paperGaps.rightPt)} />
        </>
      ) : null}

      {paperGaps.topPt >= -0.05 ? (
        <>
          <div
            className="absolute bg-fuchsia-400/70"
            style={{ left: midX, top: 0, width: 1, height: Math.max(0, paperGaps.topPt) * scale }}
          />
          <MeasureLabel left={midX} top={Math.max(0, paperGaps.topPt) * scale * 0.5} text={formatMmFromPt(paperGaps.topPt)} />
        </>
      ) : null}

      {paperGaps.bottomPt >= -0.05 ? (
        <>
          <div
            className="absolute bg-fuchsia-400/70"
            style={{ left: midX, top: bottom * scale, width: 1, height: Math.max(0, paperGaps.bottomPt) * scale }}
          />
          <MeasureLabel left={midX} top={(bottom + Math.max(0, paperGaps.bottomPt) / 2) * scale} text={formatMmFromPt(paperGaps.bottomPt)} />
        </>
      ) : null}

      {neighborGaps.map((gap, index) => {
        const horizontal = gap.axis === "x";
        const length = gap.endPt - gap.startPt;
        return (
          <div key={`gap-${gap.axis}-${index}`}>
            <div
              className="absolute bg-fuchsia-500"
              style={
                horizontal
                  ? { left: gap.startPt * scale, top: gap.midPt * scale, width: length * scale, height: 1 }
                  : { left: gap.midPt * scale, top: gap.startPt * scale, width: 1, height: length * scale }
              }
            />
            <MeasureLabel
              left={horizontal ? ((gap.startPt + gap.endPt) / 2) * scale : gap.midPt * scale}
              top={horizontal ? gap.midPt * scale : ((gap.startPt + gap.endPt) / 2) * scale}
              text={formatMmFromPt(gap.gapPt)}
            />
          </div>
        );
      })}
    </div>
  );
}
