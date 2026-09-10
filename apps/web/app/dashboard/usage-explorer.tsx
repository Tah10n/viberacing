"use client";

import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  aggregateUsageChartDays,
  usageChartDayCount,
  usageChartNextBucket,
  usageChartUnit,
  type UsageChartBucket,
} from "@/lib/usage-chart";
import { addUtcDays } from "@/lib/usage-period";
import { formatCompactTokens, formatExactTokens } from "@/lib/leaderboard-format";

export interface UsageExplorerDay {
  readonly date: string;
  readonly label: string;
  readonly tokens: string;
}

interface UsageExplorerProps {
  readonly days: readonly UsageExplorerDay[];
  readonly history?: readonly Pick<UsageExplorerDay, "date" | "tokens">[];
  readonly historyTo?: string;
  readonly periodLabel: string;
  readonly rangeLabel: string;
  readonly status: "complete" | "partial" | "no-data";
}

interface Viewport {
  readonly size: number;
  readonly start: number;
}

const utcEpoch = "1970-01-01";
const utcDayFormatter = new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" });
const plotLeft = 72;
const plotRight = 18;
const plotTop = 18;
const plotBottom = 48;

export function usageChartPointerIndex(
  clientX: number,
  boundsLeft: number,
  boundsWidth: number,
  length: number,
  chartWidth = 1_000,
  startOffset = 0,
): number {
  const viewBoxX = ((clientX - boundsLeft) / Math.max(1, boundsWidth)) * chartWidth;
  const ratio = Math.max(
    0,
    Math.min(1, (viewBoxX - plotLeft) / (chartWidth - plotLeft - plotRight)),
  );
  return Math.min(
    Math.max(0, Math.ceil(startOffset + length) - 1),
    Math.floor(startOffset + ratio * length),
  );
}

const DailyValues = memo(function DailyValues({
  days,
  unitLabel,
}: {
  readonly days: readonly UsageChartBucket[];
  readonly unitLabel: string;
}) {
  return (
    <details className="usage-values">
      <summary>{unitLabel} UTC values</summary>
      <div className="table-scroll usage-values-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">UTC range</th>
              <th scope="col">Exact tokens</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>
                  {utcDayFormatter.format(new Date(`${day.date}T00:00:00Z`))}
                  {day.to === day.date ? "" : ` – ${day.to}`}
                </td>
                <td>{formatExactTokens(day.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
});

function clampViewport(viewport: Viewport, length: number, firstDay = 0): Viewport {
  const size = Math.max(1, Math.min(length, viewport.size));
  return { size, start: Math.max(firstDay, Math.min(firstDay + length - size, viewport.start)) };
}

function zoomViewport(
  viewport: Viewport,
  length: number,
  minimumSize: number,
  factor: number,
  anchor = 0.5,
  firstDay = 0,
  continuous = false,
): Viewport {
  const current = clampViewport(viewport, length, firstDay);
  const requestedSize = current.size * factor;
  const size = Math.max(
    minimumSize,
    Math.min(length, continuous ? requestedSize : Math.round(requestedSize)),
  );
  if (size === current.size) return current;
  const start = current.start + (current.size - size) * anchor;
  return clampViewport({ size, start: continuous ? start : Math.round(start) }, length, firstDay);
}

export function UsageExplorer({
  days,
  history,
  historyTo,
  periodLabel,
  rangeLabel,
  status,
}: UsageExplorerProps) {
  const historyDays = history ?? days;
  const historyFrom = historyDays[0]?.date;
  const initialFrom = days[0]?.date ?? historyFrom ?? utcEpoch;
  const initialTo = days.at(-1)?.date ?? initialFrom;
  const domainFrom =
    historyFrom !== undefined && historyFrom < initialFrom ? historyFrom : initialFrom;
  const domainTo = historyTo ?? initialTo;
  const length = usageChartDayCount(domainFrom, domainTo);
  // Absolute UTC days keep the visible dates stable when Sync extends history.
  const domainStart = usageChartDayCount(utcEpoch, domainFrom) - 1;
  const initialStart = usageChartDayCount(utcEpoch, initialFrom) - 1;
  const initialSize = Math.max(1, days.length);
  const canvasRef = useRef<HTMLDivElement>(null);
  const clipId = useId();
  const [{ width: chartWidth, height: chartHeight }, setChartSize] = useState({
    width: 1_000,
    height: 300,
  });
  const [viewport, setViewport] = useState<Viewport>({ size: initialSize, start: initialStart });
  const [hovered, setHovered] = useState<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    viewport: Viewport;
    center: number;
    distance: number;
  } | null>(null);
  const frame = useRef<number | null>(null);
  const pendingViewport = useRef<Viewport | null>(null);
  const minimumSize = 1;
  const bounded = clampViewport(viewport, length, domainStart);
  // Keep a continuous viewport; round only when selecting whole UTC totals.
  const from = addUtcDays(utcEpoch, Math.floor(bounded.start));
  const to = addUtcDays(utcEpoch, Math.ceil(bounded.start + bounded.size) - 1);
  const unit = usageChartUnit(bounded.size);
  const unitLabel = { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  const inInitialRange = from >= initialFrom && to <= initialTo;
  const visible = useMemo(
    () => aggregateUsageChartDays(historyDays, from, to, unit),
    [historyDays, from, to, unit],
  );
  const values = visible.map((day) => BigInt(day.tokens));
  const maximum = values.reduce((max, value) => (value > max ? value : max), 0n);
  const plotWidth = chartWidth - plotLeft - plotRight;
  const plotHeight = chartHeight - plotTop - plotBottom;
  const bucketBounds = (day: UsageChartBucket) => {
    const start = usageChartDayCount(utcEpoch, day.key) - 1;
    const end = usageChartDayCount(utcEpoch, usageChartNextBucket(day.key, unit)) - 1;
    // Intersect continuously, rather than placing partial totals outside the plot.
    return {
      start: Math.max(bounded.start, start),
      end: Math.min(bounded.start + bounded.size, end),
    };
  };
  const x = (index: number): number => {
    const bucket = visible[index];
    if (bucket === undefined) return plotLeft;
    const { start, end } = bucketBounds(bucket);
    return plotLeft + (((start + end) / 2 - bounded.start) / bounded.size) * plotWidth;
  };
  const barWidth = (day: UsageChartBucket): number => {
    const { start, end } = bucketBounds(day);
    return Math.min(56, ((plotWidth * (end - start)) / bounded.size) * 0.72);
  };
  const y = (value: bigint): number => {
    if (maximum === 0n) return plotTop + plotHeight;
    const ratio = Number((value * 10_000n) / maximum) / 10_000;
    return plotTop + plotHeight * (1 - ratio);
  };
  const hoveredDay = hovered === null ? null : (visible[hovered] ?? null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined || entry.contentRect.width <= 0 || entry.contentRect.height <= 0)
        return;
      setChartSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
    };
  }, [status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || length <= minimumSize) return;
    function onWheel(event: WheelEvent) {
      if (canvas === null || pointers.current.size > 0) return;
      event.preventDefault();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
      if (!event.ctrlKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const renderedPlotWidth = Math.max(1, canvas.clientWidth - plotLeft - plotRight);
        setViewport((current) =>
          clampViewport(
            {
              ...current,
              start: current.start + (event.deltaX * unit * current.size) / renderedPlotWidth,
            },
            length,
            domainStart,
          ),
        );
      } else {
        const bounds = canvas.getBoundingClientRect();
        const anchor = Math.max(
          0,
          Math.min(
            1,
            (event.clientX - bounds.left - plotLeft) /
              Math.max(1, bounds.width - plotLeft - plotRight),
          ),
        );
        const factor = Math.exp(Math.max(-1, Math.min(1, (event.deltaY * unit) / 240)));
        setViewport((current) =>
          zoomViewport(current, length, minimumSize, factor, anchor, domainStart, true),
        );
      }
      setHovered(null);
    }
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [length, domainStart, minimumSize, status]);

  function changeZoom(factor: number) {
    if (length <= 0) return;
    setViewport((current) => zoomViewport(current, length, minimumSize, factor, 0.5, domainStart));
    setHovered(null);
  }

  function pan(offset: number) {
    if (length <= 0) return;
    setViewport((current) =>
      clampViewport({ ...current, start: current.start + offset }, length, domainStart),
    );
    setHovered(null);
  }

  function reset() {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    pendingViewport.current = null;
    gesture.current = null;
    setViewport({ size: initialSize, start: initialStart });
    setHovered(null);
  }

  function pointerIndex(event: PointerEvent<SVGSVGElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    const dayIndex = usageChartPointerIndex(
      event.clientX,
      bounds.left,
      bounds.width,
      bounded.size,
      chartWidth,
      bounded.start - Math.floor(bounded.start),
    );
    const date = addUtcDays(from, dayIndex);
    return visible.findIndex((bucket) => date >= bucket.date && date <= bucket.to);
  }

  function beginGesture(view = bounded) {
    const [first, second] = [...pointers.current.values()];
    gesture.current =
      first === undefined
        ? null
        : {
            viewport: view,
            center: second === undefined ? first.x : (first.x + second.x) / 2,
            distance: second === undefined ? 0 : Math.hypot(second.x - first.x, second.y - first.y),
          };
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const next = pendingViewport.current ?? bounded;
    if (pendingViewport.current !== null) setViewport(next);
    pendingViewport.current = null;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    beginGesture(next);
    setHovered(pointerIndex(event));
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const active = gesture.current;
    if (!pointers.current.has(event.pointerId) || active === null) {
      setHovered(pointerIndex(event));
      return;
    }
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [first, second] = [...pointers.current.values()];
    if (first === undefined) return;
    const center = second === undefined ? first.x : (first.x + second.x) / 2;
    const distance = second === undefined ? 0 : Math.hypot(second.x - first.x, second.y - first.y);
    const bounds = event.currentTarget.getBoundingClientRect();
    const renderedPlotWidth = Math.max(1, bounds.width * (plotWidth / chartWidth));
    const anchor = Math.max(
      0,
      Math.min(
        1,
        (active.center - bounds.left - (bounds.width * plotLeft) / chartWidth) / renderedPlotWidth,
      ),
    );
    const zoomed = zoomViewport(
      active.viewport,
      length,
      minimumSize,
      active.distance > 0 && distance > 0 ? active.distance / distance : 1,
      anchor,
      domainStart,
      true,
    );
    const delta = ((active.center - center) / renderedPlotWidth) * zoomed.size;
    if (Math.abs(active.center - center) < 4 && second === undefined) return;
    setHovered(null);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    pendingViewport.current = clampViewport(
      { ...zoomed, start: zoomed.start + delta },
      length,
      domainStart,
    );
    frame.current = requestAnimationFrame(() => {
      if (pendingViewport.current !== null) setViewport(pendingViewport.current);
      pendingViewport.current = null;
      frame.current = null;
    });
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    if (!pointers.current.delete(event.pointerId)) return;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const next = pendingViewport.current ?? bounded;
    if (pendingViewport.current !== null) setViewport(next);
    pendingViewport.current = null;
    beginGesture(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (event.type === "pointercancel") setHovered(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const panStep = Math.max(1, Math.round(bounded.size / 5));
    if (event.key === "ArrowLeft") pan(-panStep);
    else if (event.key === "ArrowRight") pan(panStep);
    else if (event.key === "+" || event.key === "=") changeZoom(0.65);
    else if (event.key === "-") changeZoom(1.5);
    else if (event.key === "Home") reset();
    else return;
    event.preventDefault();
  }

  const tickIndexes = useMemo(() => {
    if (visible.length <= 1) return [0];
    return [...new Set([0, Math.floor((visible.length - 1) / 2), visible.length - 1])];
  }, [visible.length]);

  if (status === "no-data" && days.length === 0 && history === undefined) {
    return (
      <figure aria-labelledby="usage-chart-title" className="usage-explorer">
        <p className="usage-explorer-empty">
          No exact usage was reported for this period. Connect an agent or choose another period.
        </p>
      </figure>
    );
  }

  return (
    <figure aria-labelledby="usage-chart-title" className="usage-explorer">
      <figcaption>
        <span className="sr-only">
          {periodLabel} daily usage for {rangeLabel}. Viewport controls do not change totals.
        </span>
        <div className="usage-explorer-controls" role="group" aria-label="Chart viewport controls">
          <span className="usage-explorer-hint">Scroll or pinch to zoom · Drag to pan</span>
          <button
            aria-label="Reset usage chart view"
            disabled={bounded.start === initialStart && bounded.size === initialSize}
            onClick={() => {
              reset();
            }}
            type="button"
          >
            Reset view
          </button>
          <output aria-live="polite">
            {from}–{to}
          </output>
        </div>
      </figcaption>
      <p className="usage-explorer-context">
        <strong>{unitLabel} totals · UTC</strong>
        {inInitialRange ? "" : " · Exploring history; summary cards keep the selected period."}
      </p>
      {status === "partial" && inInitialRange ? (
        <p className="usage-explorer-status">
          Partial current-year history. Available exact totals are shown.
        </p>
      ) : null}
      <div
        aria-label="Interactive daily token chart. Use arrow keys to pan, plus and minus to zoom, and Home to reset."
        className="usage-explorer-canvas"
        ref={canvasRef}
        onKeyDown={onKeyDown}
        role="group"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          onDoubleClick={reset}
          onLostPointerCapture={endPointer}
          onPointerCancel={endPointer}
          onPointerDown={onPointerDown}
          onPointerLeave={(event) => {
            if (event.pointerType !== "touch") setHovered(null);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          preserveAspectRatio="none"
          viewBox={`0 0 ${chartWidth.toString()} ${chartHeight.toString()}`}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x={plotLeft} y={0} width={plotWidth} height={chartHeight} />
            </clipPath>
            <clipPath id={`${clipId}-labels`}>
              <rect x={0} y={0} width={chartWidth} height={chartHeight} />
            </clipPath>
          </defs>
          <line
            className="usage-grid-line"
            x1={plotLeft}
            x2={chartWidth - plotRight}
            y1={plotTop}
            y2={plotTop}
          />
          <line
            className="usage-grid-line"
            x1={plotLeft}
            x2={chartWidth - plotRight}
            y1={plotTop + plotHeight / 2}
            y2={plotTop + plotHeight / 2}
          />
          <line
            className="usage-grid-line"
            x1={plotLeft}
            x2={chartWidth - plotRight}
            y1={plotTop + plotHeight}
            y2={plotTop + plotHeight}
          />
          <text className="usage-axis-label" x={plotLeft - 8} y={plotTop + 4}>
            {formatCompactTokens(maximum.toString())}
          </text>
          <text className="usage-axis-label" x={plotLeft - 8} y={plotTop + plotHeight / 2 + 4}>
            {formatCompactTokens((maximum / 2n).toString())}
          </text>
          <text className="usage-axis-label" x={plotLeft - 8} y={plotTop + plotHeight + 4}>
            0
          </text>
          <g clipPath={`url(#${clipId})`}>
            {visible.map((day, index) => (
              <rect
                className={`usage-series-bar${hovered === index ? " usage-series-bar-active" : ""}`}
                key={day.key}
                data-date={day.key}
                x={x(index) - barWidth(day) / 2}
                y={y(BigInt(day.tokens))}
                width={barWidth(day)}
                height={plotTop + plotHeight - y(BigInt(day.tokens))}
                rx={Math.min(3, barWidth(day) / 4)}
              />
            ))}
          </g>
          <g clipPath={`url(#${clipId}-labels)`}>
            {tickIndexes.map((index) => (
              <text
                className="usage-date-label"
                key={visible[index]?.key}
                x={x(index)}
                y={chartHeight - 14}
              >
                {unit === "year"
                  ? visible[index]?.key.slice(0, 4)
                  : unit === "month"
                    ? visible[index]?.key.slice(0, 7)
                    : visible[index]?.date.slice(5)}
              </text>
            ))}
          </g>
        </svg>
        {maximum === 0n ? (
          <p className="usage-explorer-loading">
            No usage reported in this range. Drag to explore history.
          </p>
        ) : null}
        {hoveredDay === null ? null : (
          <output className="usage-tooltip">
            <time dateTime={hoveredDay.date}>
              {hoveredDay.date}
              {hoveredDay.to === hoveredDay.date ? "" : `–${hoveredDay.to}`} UTC
            </time>
            {hoveredDay.partial ? <span>Partial {unit}</span> : null}
            <strong>{formatExactTokens(hoveredDay.tokens)} tokens</strong>
          </output>
        )}
      </div>
      <DailyValues days={visible} unitLabel={unitLabel} />
    </figure>
  );
}
