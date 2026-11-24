'use client';

import { useState } from 'react';

export interface VisibilityPoint {
  key: string;
  clicks: number;
  averagePosition: number | null;
}

export interface VisibilityChartProps {
  /** Oldest first. */
  series: VisibilityPoint[];
  /** The selected competitor on the same keywords. */
  competitor?: { domain: string; series: VisibilityPoint[] } | null;
  formatKey(key: string): string;
}

const WIDTH = 1000;
const HEIGHT = 150;
const PAD = 6;

/** Estimated monthly clicks (or average position) of the shown keywords per column. */
export function VisibilityChart({ series, competitor, formatKey }: VisibilityChartProps) {
  const [mode, setMode] = useState<'clicks' | 'position'>('clicks');
  if (series.length < 2) return null;

  const valueOf = (point: VisibilityPoint) => (mode === 'clicks' ? point.clicks : point.averagePosition);
  const ours = series.map(valueOf);
  const theirs = competitor ? competitor.series.map(valueOf) : [];
  const all = [...ours, ...theirs].filter((value): value is number => value !== null);
  if (!all.length) return null;

  const min = mode === 'clicks' ? 0 : Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (index: number) => (index / (series.length - 1)) * WIDTH;
  // Clicks grow upwards; a better (smaller) position is higher too.
  const y = (value: number) =>
    mode === 'clicks'
      ? HEIGHT - PAD - ((value - min) / span) * (HEIGHT - 2 * PAD)
      : PAD + ((value - min) / span) * (HEIGHT - 2 * PAD);

  const line = (values: (number | null)[]) =>
    values
      .map((value, index) => (value === null ? null : `${x(index).toFixed(1)},${y(value).toFixed(1)}`))
      .filter(Boolean)
      .join(' ');
  const ourLine = line(ours);
  const area = mode === 'clicks' && ourLine ? `0,${HEIGHT} ${ourLine} ${WIDTH},${HEIGHT}` : null;

  const first = ours.find((value) => value !== null) ?? null;
  const last = [...ours].reverse().find((value) => value !== null) ?? null;
  const change = first !== null && last !== null && first !== 0 ? ((last - first) / first) * 100 : null;
  const better = change === null ? null : mode === 'clicks' ? change > 0 : change < 0;
  const middle = Math.floor((series.length - 1) / 2);

  return (
    <section className="sdp-chart">
      <header className="sdp-chart-header">
        <div className="sdp-chart-value">
          <span className="sdp-stat-label">{mode === 'clicks' ? 'Visibility, est. clicks/mo' : 'Average position'}</span>
          <strong>{last === null ? '—' : mode === 'clicks' ? Math.round(last).toLocaleString('en-US') : last}</strong>
          {change !== null && (
            <span className={better ? 'sdp-up' : 'sdp-down'}>
              {change > 0 ? '+' : ''}
              {change.toFixed(1)}%
            </span>
          )}
        </div>
        <div className="sdp-legend">
          <span className="sdp-legend-ours">Our site</span>
          {competitor && <span className="sdp-legend-competitor">{competitor.domain}</span>}
        </div>
        <div className="sdp-segmented" role="group" aria-label="Chart">
          <button type="button" aria-pressed={mode === 'clicks'} onClick={() => setMode('clicks')}>
            Visibility
          </button>
          <button type="button" aria-pressed={mode === 'position'} onClick={() => setMode('position')}>
            Avg. position
          </button>
        </div>
      </header>
      <div className="sdp-chart-plot">
        <span className="sdp-chart-y sdp-chart-y-top">{mode === 'clicks' ? Math.round(max).toLocaleString('en-US') : min}</span>
        <span className="sdp-chart-y sdp-chart-y-bottom">{mode === 'clicks' ? 0 : max}</span>
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
          {area && <polygon className="sdp-chart-area" points={area} />}
          {competitor && <polyline className="sdp-chart-line-competitor" points={line(theirs)} vectorEffect="non-scaling-stroke" />}
          <polyline className="sdp-chart-line" points={ourLine} vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <div className="sdp-chart-x">
        <span>{formatKey(series[0].key)}</span>
        <span>{formatKey(series[middle].key)}</span>
        <span>{formatKey(series[series.length - 1].key)}</span>
      </div>
    </section>
  );
}
