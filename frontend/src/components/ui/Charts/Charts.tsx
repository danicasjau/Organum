import { useId, useMemo, useRef, useState } from 'react';
import { cn } from '../_internal/cn';
import { useCssVarRef } from '../_internal/useCssVar';
import './Charts.css';

const SERIES_COLORS = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
  'var(--series-8)',
] as const;

const SERIES_DASHES = [
  undefined,
  '4 2',
  '2 2',
  '6 2 2 2',
  undefined,
  '4 2',
  '2 2',
  '6 2 2 2',
] as const;

function LegendSwatch({ color }: { color: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useCssVarRef(ref, '--chart-series-color', color);
  return <span ref={ref} className="org-chart__legend-swatch" />;
}

export interface ChartSeries {
  id: string;
  label: string;
  data: ReadonlyArray<{ x: number; y: number }>;
  color?: string;
}

export interface LineChartProps {
  title?: string;
  series: ReadonlyArray<ChartSeries>;
  xLabel?: string;
  yLabel?: string;
  className?: string;
}

export function LineChart({ title, series, className }: LineChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 440;
  const h = 156;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const bounds = useMemo(() => {
    const pts = series.flatMap((s) => s.data);
    if (pts.length === 0) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const minX = Math.min(...pts.map((p) => p.x));
    let maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    let maxY = Math.max(...pts.map((p) => p.y));
    if (minX === maxX) maxX = minX + 1;
    if (minY === maxY) maxY = minY + 1;
    return { minX, maxX, minY, maxY };
  }, [series]);

  const toX = (x: number) => padL + ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * plotW;
  const toY = (y: number) => padT + plotH - ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * plotH;

  const primary = series[0]?.data ?? [];
  const hoveredPt = hoverIdx !== null ? primary[hoverIdx] : null;

  return (
    <div className={cn('org-chart', className)}>
      {(title || series.length > 0) && (
        <div className="org-chart__header">
          {title && <span className="org-chart__title">{title}</span>}
          <div className="org-chart__legend">
            {series.slice(0, 8).map((s, idx) => (
              <span key={s.id} className="org-chart__legend-item">
                <LegendSwatch color={s.color ?? SERIES_COLORS[idx % 8] ?? 'var(--series-1)'} />
                <span>{s.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <svg
        className="org-chart__svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={title ?? 'Line chart'}
        onMouseLeave={() => setHoverIdx(null)}
        onMouseMove={(e) => {
          if (primary.length === 0) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * w;
          const t = Math.max(0, Math.min(1, (relX - padL) / plotW));
          setHoverIdx(Math.round(t * (primary.length - 1)));
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + f * plotH;
          const val = bounds.maxY - f * (bounds.maxY - bounds.minY);
          return (
            <g key={f}>
              <line x1={padL} y1={y} x2={w - padR} y2={y} className="org-chart__grid-line" />
              <text x={padL - 4} y={y + 3} textAnchor="end" className="org-chart__tick-label">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="org-chart__axis-line" />
        <line
          x1={padL}
          y1={padT + plotH}
          x2={w - padR}
          y2={padT + plotH}
          className="org-chart__axis-line"
        />
        {series.slice(0, 8).map((s, idx) => {
          const d = s.data
            .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(pt.x).toFixed(1)} ${toY(pt.y).toFixed(1)}`)
            .join(' ');
          return (
            <path
              key={s.id}
              d={d}
              fill="none"
              stroke={s.color ?? SERIES_COLORS[idx % 8]}
              strokeWidth={1.5}
              strokeDasharray={SERIES_DASHES[idx % 8]}
            />
          );
        })}
        {hoveredPt && (
          <line
            x1={toX(hoveredPt.x)}
            y1={padT}
            x2={toX(hoveredPt.x)}
            y2={padT + plotH}
            className="org-chart__crosshair"
          />
        )}
      </svg>
      <div className="org-chart__readout">
        {hoveredPt
          ? `X=${hoveredPt.x.toFixed(1)} | ${series
            .slice(0, 4)
            .map((s) => `${s.label}=${(s.data[hoverIdx ?? 0]?.y ?? 0).toFixed(2)}`)
            .join('  ')}`
          : 'Hover chart for sample readout'}
      </div>
    </div>
  );
}

export interface ScatterPlotProps {
  title?: string;
  points: ReadonlyArray<{ x: number; y: number; label?: string; seriesIndex?: number }>;
  className?: string;
}

export function ScatterPlot({ title, points, className }: ScatterPlotProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 440;
  const h = 156;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 20;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const minX = points.length ? Math.min(...points.map((p) => p.x)) : 0;
  const maxX = points.length ? Math.max(...points.map((p) => p.x), minX + 1) : 1;
  const minY = points.length ? Math.min(...points.map((p) => p.y)) : 0;
  const maxY = points.length ? Math.max(...points.map((p) => p.y), minY + 1) : 1;
  const toX = (x: number) => padL + ((x - minX) / (maxX - minX)) * plotW;
  const toY = (y: number) => padT + plotH - ((y - minY) / (maxY - minY)) * plotH;

  return (
    <div className={cn('org-chart', className)}>
      {title && <span className="org-chart__title">{title}</span>}
      <svg className="org-chart__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title ?? 'Scatter plot'}>
        {[0, 0.5, 1].map((f) => {
          const y = padT + f * plotH;
          return <line key={f} x1={padL} y1={y} x2={w - padR} y2={y} className="org-chart__grid-line" />;
        })}
        <line x1={padL} y1={padT + plotH} x2={w - padR} y2={padT + plotH} className="org-chart__axis-line" />
        <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} className="org-chart__axis-line" />
        {points.map((p, idx) => (
          <rect
            key={idx}
            x={toX(p.x) - 3}
            y={toY(p.y) - 3}
            width={6}
            height={6}
            fill={SERIES_COLORS[(p.seriesIndex ?? 0) % 8]}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}
      </svg>
      <div className="org-chart__readout">
        {hoverIdx !== null && points[hoverIdx]
          ? `${points[hoverIdx].label ?? 'Point'}: (${points[hoverIdx].x.toFixed(2)}, ${points[hoverIdx].y.toFixed(2)})`
          : `${points.length} samples`}
      </div>
    </div>
  );
}

export interface BarChartProps {
  title?: string;
  bars: ReadonlyArray<{ label: string; value: number; color?: string }>;
  className?: string;
}

export function BarChart({ title, bars, className }: BarChartProps) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const w = 440;
  const h = 156;
  const padL = 36;
  const padR = 12;
  const padT = 10;
  const padB = 22;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;
  const maxVal = Math.max(1e-5, ...bars.map((b) => b.value));
  const step = plotW / Math.max(1, bars.length);
  const bw = Math.max(4, step * 0.65);

  return (
    <div className={cn('org-chart', className)}>
      {title && <span className="org-chart__title">{title}</span>}
      <svg className="org-chart__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title ?? 'Bar chart'}>
        {[0, 0.5, 1].map((f) => {
          const y = padT + f * plotH;
          return <line key={f} x1={padL} y1={y} x2={w - padR} y2={y} className="org-chart__grid-line" />;
        })}
        <line x1={padL} y1={padT + plotH} x2={w - padR} y2={padT + plotH} className="org-chart__axis-line" />
        {bars.map((b, i) => {
          const bh = (b.value / maxVal) * plotH;
          const x = padL + i * step + (step - bw) / 2;
          const y = padT + plotH - bh;
          return (
            <g key={b.label} onMouseEnter={() => setHoverIdx(i)} onMouseLeave={() => setHoverIdx(null)}>
              <rect
                x={x}
                y={y}
                width={bw}
                height={Math.max(1, bh)}
                fill={b.color ?? SERIES_COLORS[i % 8]}
                stroke="var(--border-dark)"
                strokeWidth={1}
              />
              <text x={x + bw / 2} y={h - 6} textAnchor="middle" className="org-chart__tick-label">
                {b.label.slice(0, 8)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="org-chart__readout">
        {hoverIdx !== null && bars[hoverIdx]
          ? `${bars[hoverIdx].label}: ${bars[hoverIdx].value.toFixed(2)}`
          : `Max: ${maxVal.toFixed(2)}`}
      </div>
    </div>
  );
}

export interface HistogramChannel {
  id: string;
  label: string;
  bins: ReadonlyArray<number>;
  color: string;
}

export interface HistogramProps {
  title?: string;
  channels: ReadonlyArray<HistogramChannel>;
  compact?: boolean;
  className?: string;
}

export function Histogram({ title, channels, compact = false, className }: HistogramProps) {
  const w = 320;
  const h = compact ? 96 : 140;
  const pad = 6;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const maxBin = Math.max(1e-5, ...channels.flatMap((c) => c.bins));

  return (
    <div className={cn('org-chart', className)}>
      {title && (
        <div className="org-chart__header">
          <span className="org-chart__title">{title}</span>
          <div className="org-chart__legend">
            {channels.map((c) => (
              <span key={c.id} className="org-chart__legend-item">
                <LegendSwatch color={c.color} />
                <span>{c.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}
      <svg
        className="org-chart__svg"
        data-compact={compact ? 'true' : undefined}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={title ?? 'Histogram scope'}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={pad}
            y1={pad + f * plotH}
            x2={w - pad}
            y2={pad + f * plotH}
            className="org-chart__grid-line"
          />
        ))}
        {channels.map((ch) => {
          const count = Math.max(1, ch.bins.length);
          const d = ch.bins
            .map((v, i) => {
              const x = pad + (i / Math.max(1, count - 1)) * plotW;
              const y = pad + plotH - (v / maxBin) * plotH;
              return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(' ');
          return <path key={ch.id} d={d} fill="none" stroke={ch.color} strokeWidth={1.3} />;
        })}
      </svg>
    </div>
  );
}

export interface HeatmapProps {
  title?: string;
  matrix: ReadonlyArray<ReadonlyArray<number>>;
  rowLabels?: ReadonlyArray<string>;
  colLabels?: ReadonlyArray<string>;
  className?: string;
}

export function Heatmap({ title, matrix, rowLabels, colLabels, className }: HeatmapProps) {
  const [hover, setHover] = useState<{ r: number; c: number; val: number } | null>(null);
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 0;
  const flat = matrix.flat();
  const minVal = flat.length ? Math.min(...flat) : 0;
  const maxVal = flat.length ? Math.max(...flat, minVal + 1e-5) : 1;
  const w = 360;
  const h = 132;
  const padL = 48;
  const padT = 8;
  const padB = 18;
  const cw = (w - padL - 8) / Math.max(1, cols);
  const ch = (h - padT - padB) / Math.max(1, rows);

  return (
    <div className={cn('org-chart', className)}>
      {title && <span className="org-chart__title">{title}</span>}
      <svg className="org-chart__svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={title ?? 'Heatmap'}>
        {matrix.map((row, r) =>
          row.map((val, c) => {
            const norm = (val - minVal) / (maxVal - minVal);
            const tone =
              norm > 0.75
                ? 'var(--series-5)'
                : norm > 0.5
                  ? 'var(--series-4)'
                  : norm > 0.25
                    ? 'var(--series-1)'
                    : 'var(--surface-raised)';
            return (
              <rect
                key={`${r}:${c}`}
                x={padL + c * cw}
                y={padT + r * ch}
                width={Math.max(1, cw - 1)}
                height={Math.max(1, ch - 1)}
                fill={tone}
                onMouseEnter={() => setHover({ r, c, val })}
                onMouseLeave={() => setHover(null)}
              />
            );
          }),
        )}
        {rowLabels?.map((lbl, r) => (
          <text key={lbl} x={padL - 4} y={padT + r * ch + ch / 2 + 3} textAnchor="end" className="org-chart__tick-label">
            {lbl.slice(0, 6)}
          </text>
        ))}
        {colLabels?.map((lbl, c) => (
          <text key={lbl} x={padL + c * cw + cw / 2} y={h - 4} textAnchor="middle" className="org-chart__tick-label">
            {lbl.slice(0, 4)}
          </text>
        ))}
      </svg>
      <div className="org-chart__readout">
        {hover
          ? `[${rowLabels?.[hover.r] ?? hover.r}, ${colLabels?.[hover.c] ?? hover.c}] = ${hover.val.toFixed(2)}`
          : `Range: ${minVal.toFixed(1)} .. ${maxVal.toFixed(1)}`}
      </div>
    </div>
  );
}

export function Sparkline({
  values,
  color = 'var(--series-1)',
  ariaLabel = 'Sparkline',
}: {
  values: ReadonlyArray<number>;
  color?: string;
  ariaLabel?: string;
}) {
  const w = 84;
  const h = 20;
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values, min + 1e-5) : 1;
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * (w - 4) + 2;
      const y = h - 2 - ((v - min) / (max - min)) * (h - 4);
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="org-chart__spark-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} />
    </svg>
  );
}

export function GaugeBar({
  label,
  value,
  max = 100,
  unit = '%',
  tone = 'success',
}: {
  label: string;
  value: number;
  max?: number;
  unit?: string;
  tone?: 'success' | 'warning' | 'danger' | 'accent';
}) {
  const fillRef = useRef<HTMLDivElement>(null);
  const pct = Math.max(0, Math.min(100, (value / Math.max(1e-5, max)) * 100));
  useCssVarRef(fillRef, '--gauge-pct', `${pct.toFixed(1)}%`);

  return (
    <div className="org-gauge">
      <div className="org-gauge__row">
        <span>{label}</span>
        <span>
          {value.toFixed(1)} / {max} {unit}
        </span>
      </div>
      <div className="org-gauge__track" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div ref={fillRef} className="org-gauge__fill" data-tone={tone} />
      </div>
    </div>
  );
}

export interface DagNode {
  id: string;
  label: string;
  x: number;
  y: number;
  kind?: string;
}

export interface DagEdge {
  from: string;
  to: string;
}

export function NodeGraph({
  title,
  nodes,
  edges,
  className,
}: {
  title?: string;
  nodes: ReadonlyArray<DagNode>;
  edges: ReadonlyArray<DagEdge>;
  className?: string;
}) {
  const uid = useId();
  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const nodeW = 92;
  const nodeH = 34;

  return (
    <div className={cn('org-chart', className)}>
      {title && <span className="org-chart__title">{title}</span>}
      <svg className="org-chart__node-svg" viewBox="0 0 440 160" role="img" aria-label={title ?? 'Node graph'}>
        <defs>
          <marker id={`${uid}-arrow`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 Z" fill="var(--accent)" />
          </marker>
        </defs>
        {edges.map((e, i) => {
          const a = nodeMap.get(e.from);
          const b = nodeMap.get(e.to);
          if (!a || !b) return null;
          const x1 = a.x + nodeW;
          const y1 = a.y + nodeH / 2;
          const x2 = b.x;
          const y2 = b.y + nodeH / 2;
          const mx = (x1 + x2) / 2;
          return (
            <path
              key={`${e.from}-${e.to}-${i}`}
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1.5}
              markerEnd={`url(#${uid}-arrow)`}
            />
          );
        })}
        {nodes.map((n) => (
          <g key={n.id}>
            <rect
              x={n.x}
              y={n.y}
              width={nodeW}
              height={nodeH}
              fill="var(--surface-raised)"
              stroke="var(--border-control)"
              strokeWidth={1}
            />
            <rect x={n.x} y={n.y} width={3} height={nodeH} fill="var(--accent)" />
            <text x={n.x + 8} y={n.y + 14} className="org-chart__tick-label">
              {n.label}
            </text>
            <text x={n.x + 8} y={n.y + 27} className="org-chart__tick-label">
              {n.kind ?? 'op'}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
