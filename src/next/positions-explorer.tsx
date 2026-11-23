'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { collectDays, positionTier } from '../positions.js';
import type { KeywordPosition } from '../types.js';

import { SerpModal } from './serp-modal.js';
import type { SnapshotState } from './serp-modal.js';

export interface PositionsExplorerProps {
  rows: KeywordPosition[];
  /** The site's domain and aliases, normalized ("example.com"). */
  ourDomains: string[];
  /** Route handler that returns one results page (see `next/route`). */
  serpEndpoint: string;
  /** Days of history shown now, and the choices of the period select. */
  period: number;
  periodOptions: number[];
  /** Query parameter of the period. */
  periodParam: string;
}

type FilterKey = 'all' | 'top3' | 'top10' | 'top11_50' | 'notRanking' | 'up' | 'down' | 'ai' | 'aiOurs';
type SortState = { key: string; dir: 1 | -1 } | null;

const FILTERS: Record<FilterKey, (row: KeywordPosition) => boolean> = {
  all: () => true,
  top3: (row) => row.position !== null && row.position <= 3,
  top10: (row) => row.position !== null && row.position <= 10,
  top11_50: (row) => row.position !== null && row.position > 10 && row.position <= 50,
  notRanking: (row) => row.position === null,
  up: (row) => (row.change ?? 0) > 0,
  down: (row) => (row.change ?? 0) < 0,
  ai: (row) => row.aiOverview,
  aiOurs: (row) => row.ourDomainInAiOverview,
};

/** Columns that can be hidden; Keyword, Position and the days always show. */
const OPTIONAL_COLUMNS = [
  ['serp', 'SERP'],
  ['volume', 'Volume'],
  ['trend', 'Volume trend'],
  ['history', 'Position history'],
  ['clicks', 'Est. clicks/mo'],
  ['cpc', 'CPC'],
  ['competition', 'Competition'],
  ['change', 'Change'],
  ['best', 'Best'],
  ['url', 'URL'],
] as const;
type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number][0];
const DEFAULT_HIDDEN: OptionalColumn[] = ['cpc', 'competition'];
const STORAGE_KEY = 'sdp-hidden-columns';

/** Interactive positions table: search, filters, sorting, columns, CSV and the results page of any check. */
export function PositionsExplorer({ rows, ourDomains, serpEndpoint, period, periodOptions, periodParam }: PositionsExplorerProps) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterKey>('all');
  const [serp, setSerp] = useState('all');
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<Set<OptionalColumn>>(() => new Set(DEFAULT_HIDDEN));
  const [open, setOpen] = useState<{ rowId: string; day: string } | null>(null);
  const cache = useRef(new Map<string, SnapshotState>()).current;

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setHidden(new Set(JSON.parse(saved) as OptionalColumn[]));
    } catch {
      // private mode or bad JSON: keep the defaults
    }
  }, []);

  const toggleColumn = (column: OptionalColumn) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  };
  const shows = (column: OptionalColumn) => !hidden.has(column);

  const days = useMemo(() => collectDays(rows), [rows]);
  const serps = useMemo(() => [...new Set(rows.map((row) => row.serp).filter(Boolean))].sort(), [rows]);

  // Search and SERP narrow everything, including the tile counts; the tile filter narrows the table.
  const scoped = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((row) => {
      if (serp !== 'all' && row.serp !== serp) return false;
      if (!terms.length) return true;
      const haystack = `${row.keyword} ${row.url ?? ''}`.toLowerCase();
      return terms.every((term) => (term.startsWith('-') && term.length > 1 ? !haystack.includes(term.slice(1)) : haystack.includes(term)));
    });
  }, [rows, query, serp]);

  const visible = useMemo(() => {
    const filtered = scoped.filter(FILTERS[filter]);
    if (!sort) return filtered;
    return filtered.slice().sort((a, b) => compare(sortValue(a, sort.key), sortValue(b, sort.key), sort.dir));
  }, [scoped, filter, sort]);

  const stats = useMemo(() => {
    const ranked = scoped.map((row) => row.position).filter((value): value is number => value !== null);
    const count = (key: FilterKey) => scoped.filter(FILTERS[key]).length;
    return {
      all: scoped.length,
      top3: count('top3'),
      top10: count('top10'),
      top11_50: count('top11_50'),
      notRanking: count('notRanking'),
      up: count('up'),
      down: count('down'),
      ai: count('ai'),
      aiOurs: count('aiOurs'),
      average: ranked.length ? Math.round((ranked.reduce((sum, value) => sum + value, 0) / ranked.length) * 10) / 10 : null,
      clicks: scoped.reduce((sum, row) => sum + (row.estimatedClicks ?? 0), 0),
    };
  }, [scoped]);

  const onSort = (key: string) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: key === 'keyword' || key === 'serp' ? 1 : defaultDir(key) };
      if (current.dir === defaultDir(key)) return { key, dir: current.dir === 1 ? -1 : 1 };
      return null; // third click: back to the default order
    });
  };

  const openRow = open ? rows.find((row) => row.id === open.rowId) : undefined;
  const closeModal = useCallback(() => setOpen(null), []);
  const navigateModal = useCallback((day: string) => setOpen((current) => (current ? { ...current, day } : current)), []);

  const changePeriod = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set(periodParam, value);
    window.location.assign(url.toString());
  };

  const tiles: { key?: FilterKey; label: string; value: ReactNode; tone?: string }[] = [
    { key: 'all', label: 'Keywords', value: stats.all },
    { label: 'Avg. position', value: stats.average ?? '—' },
    { key: 'top3', label: 'Top 3', value: stats.top3, tone: 'top3' },
    { key: 'top10', label: 'Top 10', value: stats.top10, tone: 'top10' },
    { key: 'top11_50', label: '11–50', value: stats.top11_50, tone: 'top20' },
    { key: 'notRanking', label: 'Not ranking', value: stats.notRanking },
    { key: 'up', label: 'Went up', value: stats.up, tone: 'up' },
    { key: 'down', label: 'Went down', value: stats.down, tone: 'down' },
    { key: 'ai', label: 'AI Overview', value: stats.ai },
    { key: 'aiOurs', label: 'Cited in AI', value: stats.aiOurs },
    { label: 'Est. clicks/mo', value: stats.clicks.toLocaleString('en-US') },
  ];

  return (
    <>
      <div className="sdp-summary">
        {tiles.map((tile) =>
          tile.key ? (
            <button
              key={tile.label}
              type="button"
              className={`sdp-stat sdp-stat-button ${filter === tile.key ? 'sdp-stat-active' : ''} ${tile.tone ? `sdp-stat-${tile.tone}` : ''}`}
              onClick={() => setFilter(filter === tile.key || tile.key === 'all' ? 'all' : tile.key!)}
              aria-pressed={filter === tile.key}
            >
              <span className="sdp-stat-label">{tile.label}</span>
              <span className="sdp-stat-value">{tile.value}</span>
            </button>
          ) : (
            <div key={tile.label} className="sdp-stat">
              <span className="sdp-stat-label">{tile.label}</span>
              <span className="sdp-stat-value">{tile.value}</span>
            </div>
          )
        )}
      </div>

      <div className="sdp-toolbar">
        <input
          type="search"
          className="sdp-input sdp-search"
          placeholder="Search keywords or URLs (use -word to exclude)"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search keywords"
        />
        {serps.length > 1 && (
          <select className="sdp-select" value={serp} onChange={(event) => setSerp(event.target.value)} aria-label="SERP">
            <option value="all">All SERPs</option>
            {serps.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        )}
        <select className="sdp-select" value={String(period)} onChange={(event) => changePeriod(event.target.value)} aria-label="Period">
          {periodOptions.map((option) => (
            <option key={option} value={option}>
              Last {option} days
            </option>
          ))}
        </select>
        <details className="sdp-columns">
          <summary className="sdp-button">Columns</summary>
          <div className="sdp-columns-menu">
            {OPTIONAL_COLUMNS.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={shows(key)} onChange={() => toggleColumn(key)} /> {label}
              </label>
            ))}
          </div>
        </details>
        <button type="button" className="sdp-button" onClick={() => downloadCsv(visible, days)}>
          Export CSV
        </button>
        <span className="sdp-count">
          {visible.length === rows.length ? `${rows.length} keywords` : `${visible.length} of ${rows.length} keywords`}
        </span>
      </div>

      {visible.length === 0 ? (
        <p className="sdp-notice">No keywords match the search and filters.</p>
      ) : (
        <div className="sdp-table-wrap">
          <table className="sdp-table">
            <thead>
              <tr>
                <SortHeader label="Keyword" sortKey="keyword" sort={sort} onSort={onSort} className="sdp-sticky" />
                {shows('serp') && <SortHeader label="SERP" sortKey="serp" sort={sort} onSort={onSort} />}
                {shows('volume') && <SortHeader label="Volume" sortKey="volume" sort={sort} onSort={onSort} className="sdp-num" />}
                {shows('trend') && <th title="Monthly search volume, last 12 months">Trend</th>}
                {shows('history') && <th title="Position over the period">History</th>}
                {shows('clicks') && (
                  <SortHeader label="Est. clicks/mo" sortKey="clicks" sort={sort} onSort={onSort} className="sdp-num" />
                )}
                {shows('cpc') && <SortHeader label="CPC" sortKey="cpc" sort={sort} onSort={onSort} className="sdp-num" />}
                {shows('competition') && (
                  <SortHeader label="Comp." sortKey="competition" sort={sort} onSort={onSort} className="sdp-num" />
                )}
                <SortHeader label="Position" sortKey="position" sort={sort} onSort={onSort} className="sdp-center" />
                {shows('change') && <SortHeader label="Change" sortKey="change" sort={sort} onSort={onSort} className="sdp-center" />}
                {shows('best') && <SortHeader label="Best" sortKey="best" sort={sort} onSort={onSort} className="sdp-center" />}
                {shows('url') && <th>URL</th>}
                {days.map((day) => (
                  <SortHeader
                    key={day}
                    label={formatDay(day)}
                    sortKey={`day:${day}`}
                    sort={sort}
                    onSort={onSort}
                    className="sdp-center sdp-day"
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="sdp-sticky sdp-keyword">
                    <span>{row.keyword}</span>
                    {row.aiOverview && (
                      <span
                        className={`sdp-ai-mark ${row.ourDomainInAiOverview ? 'sdp-ai-mark-ours' : ''}`}
                        title={row.ourDomainInAiOverview ? 'AI Overview cites this site' : 'The results page has an AI Overview'}
                      >
                        ✦
                      </span>
                    )}
                    {row.cannibalization > 1 && (
                      <span className="sdp-cannibal" title={`${row.cannibalization} URLs of the site rank for this keyword`}>
                        ×{row.cannibalization}
                      </span>
                    )}
                  </td>
                  {shows('serp') && <td className="sdp-muted sdp-nowrap">{row.serp || '—'}</td>}
                  {shows('volume') && <td className="sdp-num">{formatNumber(row.volume)}</td>}
                  {shows('trend') && (
                    <td>
                      <VolumeBars values={row.volumeTrend} />
                    </td>
                  )}
                  {shows('history') && (
                    <td>
                      <PositionLine history={row.history} />
                    </td>
                  )}
                  {shows('clicks') && <td className="sdp-num">{formatNumber(row.estimatedClicks)}</td>}
                  {shows('cpc') && <td className="sdp-num sdp-nowrap">{formatCpc(row.cpcLow, row.cpcHigh)}</td>}
                  {shows('competition') && <td className="sdp-num">{row.competition ?? '—'}</td>}
                  <PositionCell
                    position={row.position}
                    onOpen={row.latestUpdateId ? () => openLatest(row, setOpen) : undefined}
                  />
                  {shows('change') && (
                    <td className="sdp-center">
                      <Change value={row.change} />
                    </td>
                  )}
                  {shows('best') && <td className="sdp-center">{row.bestPosition ?? '—'}</td>}
                  {shows('url') && (
                    <td className="sdp-url">
                      {row.url ? (
                        <a href={row.url} target="_blank" rel="noopener noreferrer" title={row.url}>
                          {shortUrl(row.url)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  {days.map((day) => {
                    const check = row.checksByDay[day];
                    return check ? (
                      <PositionCell
                        key={day}
                        position={check.position}
                        ai={check.aiOverview}
                        aiOurs={check.ourDomainInAiOverview}
                        className="sdp-day"
                        onOpen={() => setOpen({ rowId: row.id, day })}
                      />
                    ) : (
                      <td key={day} className="sdp-center sdp-day">
                        <span className="sdp-muted">·</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && openRow && (
        <SerpModal
          row={openRow}
          day={open.day}
          endpoint={serpEndpoint}
          ourDomains={ourDomains}
          cache={cache}
          onClose={closeModal}
          onNavigate={navigateModal}
        />
      )}
    </>
  );
}

// ----------------------------------------------------------------------

function openLatest(row: KeywordPosition, setOpen: (value: { rowId: string; day: string }) => void) {
  const day = Object.keys(row.checksByDay).sort().at(-1);
  if (day) setOpen({ rowId: row.id, day });
}

function PositionCell({
  position,
  ai = false,
  aiOurs = false,
  className = '',
  onOpen,
}: {
  position: number | null;
  ai?: boolean;
  aiOurs?: boolean;
  className?: string;
  onOpen?: () => void;
}) {
  const content = (
    <>
      {position ?? '—'}
      {ai && <span className={`sdp-ai-dot ${aiOurs ? 'sdp-ai-dot-ours' : ''}`}>✦</span>}
    </>
  );
  return (
    <td className={`sdp-center sdp-cell sdp-cell-${positionTier(position)} ${className}`.trim()}>
      {onOpen ? (
        <button type="button" className="sdp-cell-button" onClick={onOpen} title="Show the Google results of this check">
          {content}
        </button>
      ) : (
        content
      )}
    </td>
  );
}

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  className = '',
}: {
  label: string;
  sortKey: string;
  sort: SortState;
  onSort(key: string): void;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  return (
    <th className={className} aria-sort={active ? (sort!.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={`sdp-sort ${active ? 'sdp-sort-active' : ''}`} onClick={() => onSort(sortKey)}>
        {label}
        <span className="sdp-sort-arrow">{active ? (sort!.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );
}

function Change({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="sdp-muted">—</span>;
  return (
    <span className={value > 0 ? 'sdp-up' : 'sdp-down'}>
      {value > 0 ? '↑' : '↓'}
      {Math.abs(value)}
    </span>
  );
}

function VolumeBars({ values }: { values: number[] }) {
  if (!values.length || values.every((value) => !value)) return <span className="sdp-muted">—</span>;
  const max = Math.max(...values);
  const width = 52;
  const height = 18;
  const bar = width / values.length;
  return (
    <svg className="sdp-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {values.map((value, index) => {
        const h = Math.max(1, (value / max) * height);
        return <rect key={index} x={index * bar + 0.5} y={height - h} width={Math.max(1, bar - 1.5)} height={h} rx="0.5" />;
      })}
    </svg>
  );
}

function PositionLine({ history }: { history: { date: string; position: number | null }[] }) {
  const points = history.map((point, index) => ({ index, position: point.position }));
  const ranked = points.filter((point): point is { index: number; position: number } => point.position !== null);
  if (ranked.length < 2) return <span className="sdp-muted">—</span>;
  const width = 72;
  const height = 20;
  const best = Math.min(...ranked.map((point) => point.position));
  const worst = Math.max(...ranked.map((point) => point.position));
  const x = (index: number) => (points.length === 1 ? width / 2 : (index / (points.length - 1)) * (width - 4) + 2);
  const y = (position: number) => (worst === best ? height / 2 : ((position - best) / (worst - best)) * (height - 4) + 2);

  // Gaps (not ranking) break the line into segments.
  const segments: string[] = [];
  let current: string[] = [];
  for (const point of points) {
    if (point.position === null) {
      if (current.length > 1) segments.push(current.join(' '));
      current = [];
    } else {
      current.push(`${x(point.index).toFixed(1)},${y(point.position).toFixed(1)}`);
    }
  }
  if (current.length > 1) segments.push(current.join(' '));
  const last = ranked.at(-1)!;

  return (
    <svg className="sdp-spark sdp-spark-line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {segments.map((segment) => (
        <polyline key={segment} points={segment} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      ))}
      <circle cx={x(last.index)} cy={y(last.position)} r="2" />
    </svg>
  );
}

// ----------------------------------------------------------------------

/** Positions and changes read best when the first click puts the best on top. */
function defaultDir(key: string): 1 | -1 {
  if (key === 'position' || key === 'best' || key.startsWith('day:')) return 1;
  return -1;
}

function sortValue(row: KeywordPosition, key: string): number | string | null {
  switch (key) {
    case 'keyword':
      return row.keyword.toLowerCase();
    case 'serp':
      return row.serp;
    case 'volume':
      return row.volume;
    case 'clicks':
      return row.estimatedClicks;
    case 'cpc':
      return row.cpcHigh;
    case 'competition':
      return row.competition;
    case 'position':
      return row.position;
    case 'change':
      return row.change;
    case 'best':
      return row.bestPosition;
    default:
      return key.startsWith('day:') ? (row.checksByDay[key.slice(4)]?.position ?? null) : null;
  }
}

/** Empty values always go last, whatever the direction. */
function compare(a: number | string | null, b: number | string | null, dir: 1 | -1): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'string' || typeof b === 'string') return String(a).localeCompare(String(b)) * dir;
  return (a - b) * dir;
}

function downloadCsv(rows: KeywordPosition[], days: string[]) {
  const header = ['Keyword', 'SERP', 'Volume', 'Est. clicks/mo', 'Position', 'Change', 'Best', 'URL', 'AI Overview', 'Cited in AI', ...days];
  const lines = rows.map((row) => [
    row.keyword,
    row.serp,
    row.volume ?? '',
    row.estimatedClicks ?? '',
    row.position ?? '',
    row.change ?? '',
    row.bestPosition ?? '',
    row.url ?? '',
    row.aiOverview ? 'yes' : '',
    row.ourDomainInAiOverview ? 'yes' : '',
    ...days.map((day) => (day in row.checksByDay ? (row.checksByDay[day].position ?? '-') : '')),
  ]);
  const csv = [header, ...lines].map((line) => line.map(csvCell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `positions-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return value >= 10000 ? `${Math.round(value / 100) / 10}k` : value.toLocaleString('en-US');
}

function formatCpc(low: number | null, high: number | null): string {
  if (low === null && high === null) return '—';
  if (low === null || high === null || low === high) return `$${(high ?? low)!.toFixed(2)}`;
  return `$${low.toFixed(2)}–${high.toFixed(2)}`;
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function shortUrl(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    const path = pathname + search;
    try {
      return decodeURI(path) || '/';
    } catch {
      return path || '/';
    }
  } catch {
    return url;
  }
}
