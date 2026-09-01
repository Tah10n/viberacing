"use client";

import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { formatCompactTokens, formatExactTokens } from "@/lib/leaderboard-format";

export interface UsageExplorerDay {
  readonly date: string;
  readonly label: string;
  readonly tokens: string;
}

interface UsageExplorerProps {
  readonly days: readonly UsageExplorerDay[];
  readonly periodLabel: string;
  readonly rangeLabel: string;
  readonly status: "complete" | "partial" | "no-data";
}

interface Viewport {
  readonly size: number;
  readonly start: number;
}

const chartWidth = 1_000;
const chartHeight = 300;
const plotLeft = 72;
const plotRight = 18;
const plotTop = 18;
const plotBottom = 48;

export function usageChartPointerIndex(
  clientX: number,
  boundsLeft: number,
  boundsWidth: number,
  length: number,
): number {
  const viewBoxX = ((clientX - boundsLeft) / Math.max(1, boundsWidth)) * chartWidth;
  const ratio = Math.max(
    0,
    Math.min(1, (viewBoxX - plotLeft) / (chartWidth - plotLeft - plotRight)),
  );
  return Math.round(ratio * Math.max(0, length - 1));
}

const DailyValues = memo(function DailyValues({
  days,
}: {
  readonly days: readonly UsageExplorerDay[];
}) {
  return (
    <details className="usage-values">
      <summary>Daily UTC values</summary>
      <div className="table-scroll usage-values-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">UTC date</th>
              <th scope="col">Exact tokens</th>
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day.date}>
                <td>{day.label}</td>
                <td>{formatExactTokens(day.tokens)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
});

function clampViewport(viewport: Viewport, length: number): Viewport {
  const size = Math.max(1, Math.min(length, viewport.size));
  return { size, start: Math.max(0, Math.min(length - size, viewport.start)) };
}

export function UsageExplorer({ days, periodLabel, rangeLabel, status }: UsageExplorerProps) {
  const [viewport, setViewport] = useState<Viewport>({ size: Math.max(1, days.length), start: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const drag = useRef<{ pointerId: number; start: number; x: number } | null>(null);
  const frame = useRef<number | null>(null);
  const minimumSize = Math.min(days.length, 7);
  const bounded = clampViewport(viewport, Math.max(1, days.length));
  const visible = days.slice(bounded.start, bounded.start + bounded.size);
  const values = visible.map((day) => BigInt(day.tokens));
  const maximum = values.reduce((max, value) => (value > max ? value : max), 0n);
  const plotWidth = chartWidth - plotLeft - plotRight;
  const plotHeight = chartHeight - plotTop - plotBottom;
  const x = (index: number): number =>
    visible.length <= 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (index * plotWidth) / (visible.length - 1);
  const y = (value: bigint): number => {
    if (maximum === 0n) return plotTop + plotHeight;
    const ratio = Number((value * 10_000n) / maximum) / 10_000;
    return plotTop + plotHeight * (1 - ratio);
  };
  const line = visible
    .map((day, index) => `${x(index).toString()},${y(BigInt(day.tokens)).toString()}`)
    .join(" ");
  const hoveredDay = hovered === null ? null : (visible[hovered] ?? null);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  function changeZoom(factor: number) {
    if (days.length === 0) return;
    setViewport((current) => {
      const nextSize = Math.max(
        minimumSize,
        Math.min(days.length, Math.round(current.size * factor)),
      );
      const center = current.start + current.size / 2;
      return clampViewport(
        { size: nextSize, start: Math.round(center - nextSize / 2) },
        days.length,
      );
    });
    setHovered(null);
  }

  function pan(offset: number) {
    if (days.length === 0) return;
    setViewport((current) =>
      clampViewport({ ...current, start: current.start + offset }, days.length),
    );
    setHovered(null);
  }

  function reset() {
    setViewport({ size: Math.max(1, days.length), start: 0 });
    setHovered(null);
  }

  function pointerIndex(event: PointerEvent<SVGSVGElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    return usageChartPointerIndex(event.clientX, bounds.left, bounds.width, visible.length);
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, start: bounded.start, x: event.clientX };
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const active = drag.current;
    if (active === null) {
      setHovered(pointerIndex(event));
      return;
    }
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const renderedPlotWidth = Math.max(1, bounds.width * (plotWidth / chartWidth));
    const delta = Math.round(((active.x - event.clientX) / renderedPlotWidth) * bounded.size);
    frame.current = requestAnimationFrame(() => {
      setViewport((current) =>
        clampViewport({ ...current, start: active.start + delta }, days.length),
      );
    });
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
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

  return (
    <figure aria-labelledby="usage-chart-title" className="usage-explorer">
      <figcaption>
        <span className="sr-only">
          {periodLabel} daily usage for {rangeLabel}. Viewport controls do not change totals.
        </span>
        <div className="usage-explorer-controls" role="group" aria-label="Chart viewport controls">
          <button
            aria-label="Zoom in on usage chart"
            onClick={() => {
              changeZoom(0.65);
            }}
            type="button"
          >
            Zoom in
          </button>
          <button
            aria-label="Zoom out of usage chart"
            onClick={() => {
              changeZoom(1.5);
            }}
            type="button"
          >
            Zoom out
          </button>
          <button
            aria-label="Pan usage chart left"
            onClick={() => {
              pan(-Math.max(1, Math.round(bounded.size / 5)));
            }}
            type="button"
          >
            ← Pan
          </button>
          <button
            aria-label="Pan usage chart right"
            onClick={() => {
              pan(Math.max(1, Math.round(bounded.size / 5)));
            }}
            type="button"
          >
            Pan →
          </button>
          <button
            aria-label="Reset usage chart view"
            onClick={() => {
              reset();
            }}
            type="button"
          >
            Reset view
          </button>
          <output aria-live="polite">
            {visible[0]?.date ?? rangeLabel}–{visible.at(-1)?.date ?? rangeLabel}
          </output>
        </div>
      </figcaption>
      {status === "partial" ? (
        <p className="usage-explorer-status">
          Partial current-year history. Available exact totals are shown.
        </p>
      ) : null}
      {status === "no-data" ? (
        <p className="usage-explorer-empty">No exact usage was reported for this period.</p>
      ) : null}
      <div
        aria-label="Interactive daily token chart. Use arrow keys to pan, plus and minus to zoom, and Home to reset."
        className="usage-explorer-canvas"
        onKeyDown={onKeyDown}
        role="group"
        tabIndex={0}
      >
        <svg
          aria-hidden="true"
          onPointerCancel={endPointer}
          onPointerDown={onPointerDown}
          onPointerLeave={() => {
            setHovered(null);
          }}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          preserveAspectRatio="none"
          viewBox={`0 0 ${chartWidth.toString()} ${chartHeight.toString()}`}
        >
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
          {line === "" ? null : <polyline className="usage-series-line" points={line} />}
          {tickIndexes.map((index) => (
            <text
              className="usage-date-label"
              key={visible[index]?.date}
              x={x(index)}
              y={chartHeight - 14}
            >
              {visible[index]?.date.slice(5)}
            </text>
          ))}
          {hoveredDay === null || hovered === null ? null : (
            <circle
              className="usage-hover-point"
              cx={x(hovered)}
              cy={y(BigInt(hoveredDay.tokens))}
              r="6"
            />
          )}
        </svg>
        {hoveredDay === null ? null : (
          <output className="usage-tooltip">
            <time dateTime={hoveredDay.date}>{hoveredDay.date} UTC</time>
            <strong>{formatExactTokens(hoveredDay.tokens)} tokens</strong>
          </output>
        )}
      </div>
      <DailyValues days={days} />
    </figure>
  );
}
