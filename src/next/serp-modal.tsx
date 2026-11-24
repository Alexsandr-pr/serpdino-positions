'use client';

import { useEffect, useState } from 'react';

import { normalizeDomain } from '../project-match.js';
import { positionTier } from '../positions.js';
import type { KeywordPosition, SerpdinoMovement, SerpdinoSerpSnapshot } from '../types.js';

export type SnapshotState =
  | { status: 'loading' }
  | { status: 'ready'; data: SerpdinoSerpSnapshot }
  | { status: 'error'; message: string };

export interface SerpModalProps {
  row: KeywordPosition;
  /** YYYY-MM-DD of the check to show. */
  day: string;
  /** Route handler that returns one results page (see `next/route`). */
  endpoint: string;
  /** The site's domain and aliases, highlighted in the results. */
  ourDomains: string[];
  /** Loaded results pages by update id, kept between openings. */
  cache: Map<string, SnapshotState>;
  onClose(): void;
  onNavigate(day: string): void;
  /** Label of a column (day, week, month) for the date line. */
  formatKey?(key: string): string;
}

/** Popup with the Google results page that one keyword check saw. */
export function SerpModal({ row, day, endpoint, ourDomains, cache, onClose, onNavigate, formatKey }: SerpModalProps) {
  const check = row.checksByDay[day];
  const updateId = check?.updateId;
  const [state, setState] = useState<SnapshotState>(() => (updateId && cache.get(updateId)) || { status: 'loading' });

  const checkedDays = Object.keys(row.checksByDay).sort();
  const index = checkedDays.indexOf(day);
  const previousDay = index > 0 ? checkedDays[index - 1] : null;
  const nextDay = index >= 0 && index < checkedDays.length - 1 ? checkedDays[index + 1] : null;

  useEffect(() => {
    if (!updateId) return;
    const cached = cache.get(updateId);
    if (cached && cached.status !== 'error') {
      setState(cached);
      return;
    }

    let cancelled = false;
    setState({ status: 'loading' });
    const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}keywordUpdateId=${encodeURIComponent(updateId)}`;
    fetch(url, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !body?.data) throw new Error(body?.error || `Request failed with HTTP ${response.status}`);
        return { status: 'ready', data: body.data as SerpdinoSerpSnapshot } as const;
      })
      .catch((error: unknown) => ({ status: 'error', message: error instanceof Error ? error.message : String(error) }) as const)
      .then((next) => {
        cache.set(updateId, next);
        if (!cancelled) setState(next);
      });

    return () => {
      cancelled = true;
    };
  }, [updateId, endpoint, cache]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft' && previousDay) onNavigate(previousDay);
      else if (event.key === 'ArrowRight' && nextDay) onNavigate(nextDay);
    };
    document.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose, onNavigate, previousDay, nextDay]);

  const ours = (domain: string | undefined) => {
    const host = normalizeDomain(domain);
    return Boolean(host) && ourDomains.some((own) => host === own || host.endsWith(`.${own}`));
  };

  return (
    <div className="sdp-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="sdp-modal" role="dialog" aria-modal="true" aria-label={`Google results for ${row.keyword}`}>
        <header className="sdp-modal-header">
          <div className="sdp-modal-heading">
            <h2 className="sdp-modal-title">{row.keyword}</h2>
            <p className="sdp-modal-meta">
              <span>{row.serp || 'Google'}</span>
              <span>{check ? formatDate(check.date) : (formatKey?.(day) ?? day)}</span>
              <span>
                Our position: <strong>{check?.position ?? 'not ranking'}</strong>
              </span>
            </p>
          </div>
          <div className="sdp-modal-nav">
            <button
              type="button"
              className="sdp-icon-button"
              disabled={!previousDay}
              onClick={() => previousDay && onNavigate(previousDay)}
              title="Previous check (←)"
            >
              ‹
            </button>
            <button
              type="button"
              className="sdp-icon-button"
              disabled={!nextDay}
              onClick={() => nextDay && onNavigate(nextDay)}
              title="Next check (→)"
            >
              ›
            </button>
            <button type="button" className="sdp-icon-button" onClick={onClose} title="Close (Esc)">
              ×
            </button>
          </div>
        </header>

        <div className="sdp-modal-body">
          {!check ? (
            <p className="sdp-notice">There was no check on this day.</p>
          ) : state.status === 'loading' ? (
            <p className="sdp-notice">Loading the results page…</p>
          ) : state.status === 'error' ? (
            <p className="sdp-notice sdp-notice-error">{state.message}</p>
          ) : (
            <Snapshot data={state.data} ours={ours} />
          )}
        </div>
      </div>
    </div>
  );
}

function Snapshot({ data, ours }: { data: SerpdinoSerpSnapshot; ours(domain: string | undefined): boolean }) {
  const ai = data.aiOverviewResults ?? [];
  const dropped = data.droppedDomains ?? [];

  return (
    <>
      {ai.length > 0 && (
        <section className={`sdp-ai ${data.aiContainsOurDomain ? 'sdp-ai-ours' : ''}`}>
          <h3 className="sdp-ai-title">
            ✦ AI Overview <span className="sdp-muted">({ai.length})</span>
            {data.aiContainsOurDomain && <span className="sdp-badge">cites us</span>}
          </h3>
          <ol className="sdp-ai-list">
            {ai.map((item) => (
              <li key={`${item.position}-${item.url}`} className={item.isOurDomain || ours(item.domain) ? 'sdp-is-ours' : undefined}>
                <span className="sdp-ai-pos">#{item.position}</span>
                <ResultLink title={item.title} url={item.url} domain={item.domain} />
              </li>
            ))}
          </ol>
        </section>
      )}

      <table className="sdp-serp">
        <thead>
          <tr>
            <th className="sdp-center">#</th>
            <th className="sdp-center">+/-</th>
            <th>Title</th>
          </tr>
        </thead>
        <tbody>
          {data.resultList.map((result) => (
            <tr key={`${result.position}-${result.url}`} className={ours(result.domain) ? 'sdp-is-ours' : undefined}>
              <td className="sdp-center">
                <span className={`sdp-badge-pos sdp-cell-${positionTier(result.position)}`}>{result.position}</span>
              </td>
              <td className="sdp-center">
                <Movement movement={result.movement} />
              </td>
              <td>
                <ResultLink title={result.title} url={result.url} domain={result.domain} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {dropped.length > 0 && (
        <section className="sdp-dropped">
          <h3 className="sdp-dropped-title">Dropped out since the previous check</h3>
          <ul>
            {dropped.map((item) => (
              <li key={item.domain} className={ours(item.domain) ? 'sdp-is-ours' : undefined}>
                <span>{item.domain}</span>
                <span className="sdp-muted">was #{item.previousPosition ?? '—'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ResultLink({ title, url, domain }: { title?: string; url?: string; domain?: string }) {
  const label = title && title !== '-' ? title : domain || url || '—';
  return (
    <div className="sdp-result">
      {url && /^https?:\/\//.test(url) ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className="sdp-result-title">
          {label}
        </a>
      ) : (
        <span className="sdp-result-title">{label}</span>
      )}
      {url && <span className="sdp-result-url">{safeDecode(url)}</span>}
    </div>
  );
}

function Movement({ movement }: { movement?: SerpdinoMovement }) {
  if (!movement || movement.type === 'same') return <span className="sdp-muted">—</span>;
  if (movement.type === 'new') return <span className="sdp-new">NEW</span>;
  if (movement.type === 'gone') return <span className="sdp-down">gone</span>;
  const up = movement.type === 'up';
  return (
    <span className={up ? 'sdp-up' : 'sdp-down'}>
      {up ? '↑' : '↓'}
      {movement.value === null ? '' : Math.abs(movement.value)}
    </span>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCDate()).padStart(2, '0')}.${String(date.getUTCMonth() + 1).padStart(2, '0')}.${date.getUTCFullYear()}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}
