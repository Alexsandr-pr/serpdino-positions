'use client';

import { Fragment, useMemo, useState } from 'react';

import { positionTier } from '../positions.js';
import type { KeywordPosition, SerpdinoPage } from '../types.js';

export interface PagesTableProps {
  pages: SerpdinoPage[];
  /** Keyword rows, to name the keywords of a page. */
  rows: KeywordPosition[];
  query: string;
}

type SortKey = 'url' | 'keywords' | 'top10' | 'easy' | 'avg' | 'best';

/** Ranking pages of the site: keywords, top 10, easy wins, average and best position, trend. */
export function PagesTable({ pages, rows, query }: PagesTableProps) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'keywords', dir: -1 });
  const [openUrl, setOpenUrl] = useState<string | null>(null);
  const keywordById = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  const visible = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const filtered = pages.filter((page) => {
      const haystack = `${page.url} ${page.keywords.map((keyword) => keywordById.get(keyword.keywordId)?.keyword ?? '').join(' ')}`.toLowerCase();
      return terms.every((term) => (term.startsWith('-') && term.length > 1 ? !haystack.includes(term.slice(1)) : haystack.includes(term)));
    });
    const value = (page: SerpdinoPage): number | string => {
      switch (sort.key) {
        case 'url':
          return page.url;
        case 'keywords':
          return page.keywordCount;
        case 'top10':
          return page.top10Count ?? 0;
        case 'easy':
          return page.easyWinCount ?? 0;
        case 'avg':
          return page.avgPosition;
        case 'best':
          return page.bestPosition;
      }
    };
    return filtered.slice().sort((a, b) => {
      const left = value(a);
      const right = value(b);
      return (typeof left === 'string' ? left.localeCompare(String(right)) : left - (right as number)) * sort.dir;
    });
  }, [pages, query, sort, keywordById]);

  const onSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, dir: current.dir === 1 ? -1 : 1 } : { key, dir: key === 'avg' || key === 'best' || key === 'url' ? 1 : -1 }
    );

  const header = (key: SortKey, label: string, className = '') => (
    <th className={className} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={`sdp-sort ${sort.key === key ? 'sdp-sort-active' : ''}`} onClick={() => onSort(key)}>
        {label}
        <span className="sdp-sort-arrow">{sort.key === key ? (sort.dir === 1 ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  );

  if (!pages.length) return <p className="sdp-notice">SerpDino has no ranking pages for this project yet.</p>;
  if (!visible.length) return <p className="sdp-notice">No pages match the search.</p>;

  return (
    <div className="sdp-table-wrap">
      <table className="sdp-table sdp-pages">
        <thead>
          <tr>
            {header('url', 'Page', 'sdp-sticky')}
            {header('keywords', 'Keywords', 'sdp-center')}
            {header('top10', 'Top 10', 'sdp-center')}
            {header('easy', 'Easy wins', 'sdp-center')}
            {header('avg', 'Avg. position', 'sdp-center')}
            {header('best', 'Best', 'sdp-center')}
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((page) => {
            const open = openUrl === page.url;
            return (
              <Fragment key={page.url}>
                <tr>
                  <td className="sdp-sticky sdp-url sdp-page-url">
                    <a href={page.url} target="_blank" rel="noopener noreferrer" title={page.url}>
                      {pagePath(page)}
                    </a>
                  </td>
                  <td className="sdp-center">
                    <button type="button" className="sdp-link-button" aria-expanded={open} onClick={() => setOpenUrl(open ? null : page.url)}>
                      {open ? '▾' : '▸'} {page.keywordCount}
                    </button>
                  </td>
                  <td className="sdp-center">{page.top10Count ?? '—'}</td>
                  <td className="sdp-center">{page.easyWinCount ?? '—'}</td>
                  <td className={`sdp-center sdp-cell sdp-cell-${positionTier(Math.round(page.avgPosition))}`}>{round(page.avgPosition)}</td>
                  <td className={`sdp-center sdp-cell sdp-cell-${positionTier(page.bestPosition)}`}>{page.bestPosition}</td>
                  <td>
                    <TrendLine points={(page.avgPositionTrend ?? []).map((point) => point.avgPosition)} />
                  </td>
                </tr>
                {open && (
                  <tr className="sdp-page-keywords">
                    <td colSpan={7}>
                      <ul>
                        {page.keywords
                          .slice()
                          .sort((a, b) => (a.latestPosition ?? 999) - (b.latestPosition ?? 999))
                          .map((keyword) => (
                            <li key={keyword.keywordId}>
                              <span className={`sdp-badge-pos sdp-cell-${positionTier(keyword.latestPosition)}`}>{keyword.latestPosition ?? '—'}</span>
                              <span>{keywordById.get(keyword.keywordId)?.keyword ?? keyword.keywordId}</span>
                              <span className="sdp-muted">best {keyword.bestPosition ?? '—'}</span>
                            </li>
                          ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TrendLine({ points }: { points: number[] }) {
  if (points.length < 2) return <span className="sdp-muted">—</span>;
  const width = 72;
  const height = 20;
  const best = Math.min(...points);
  const worst = Math.max(...points);
  const line = points
    .map((value, index) => {
      const x = (index / (points.length - 1)) * (width - 4) + 2;
      const y = worst === best ? height / 2 : ((value - best) / (worst - best)) * (height - 4) + 2;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="sdp-spark sdp-spark-line" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={line} fill="none" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function pagePath(page: SerpdinoPage): string {
  try {
    const { pathname, search } = new URL(page.url);
    const path = pathname + search;
    try {
      return decodeURI(path) || '/';
    } catch {
      return path || '/';
    }
  } catch {
    return page.path || page.url;
  }
}

function round(value: number): string {
  return String(Math.round(value * 10) / 10);
}
