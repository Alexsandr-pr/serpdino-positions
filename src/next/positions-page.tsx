import type { ReactNode } from 'react';

import { createSerpdinoClient, SerpdinoError } from '../client.js';
import { pickProject } from '../project-match.js';
import { collectDays, getKeywordPositions, summarize } from '../positions.js';
import type { KeywordPosition, SerpdinoProject } from '../types.js';

import { ProjectSelect } from './project-select.js';

type SearchParams = Record<string, string | string[] | undefined>;

export interface SerpdinoPositionsPageProps {
  /** Page `searchParams` from Next.js (a Promise in Next 15+, a plain object before). Needed for the site switcher. */
  searchParams?: Promise<SearchParams> | SearchParams;
  /** API key. Default: process.env.SERPDINO_API_KEY. */
  apiKey?: string;
  /**
   * This site's domain; its SerpDino project opens first.
   * Default: process.env.SERPDINO_SITE_DOMAIN, otherwise the Host header of the request.
   */
  domain?: string;
  /** Show this project instead of matching by domain. */
  projectId?: string;
  /** Hide the site switcher and always show the matched project. */
  hideSwitcher?: boolean;
  /** Days of history, one column per checked day. Default: 30. */
  days?: number;
  /** Seconds to cache API responses. Default: 3600. */
  revalidate?: number;
  /** Your own CTR curve for "Est. clicks/mo" (index 0 = position 1). */
  ctrCurve?: number[];
  title?: string;
  /** Query parameter used by the switcher. Default: "project". */
  param?: string;
}

/**
 * Server component: SerpDino positions for the site's project, with a site switcher.
 *
 * ```js
 * // app/admin/positions/page.js
 * import { SerpdinoPositionsPage } from '@alex-pierierodov/serpdino-positions/next';
 * import '@alex-pierierodov/serpdino-positions/styles.css';
 *
 * export default function Page({ searchParams }) {
 *   return <SerpdinoPositionsPage searchParams={searchParams} domain="example.com" />;
 * }
 * ```
 */
export async function SerpdinoPositionsPage({
  searchParams,
  apiKey,
  domain,
  projectId,
  hideSwitcher = false,
  days = 30,
  revalidate,
  ctrCurve,
  title = 'Google positions',
  param = 'project',
}: SerpdinoPositionsPageProps) {
  const params = (await searchParams) ?? {};
  const requested = firstValue(params[param]);
  const siteDomain = domain ?? env('SERPDINO_SITE_DOMAIN') ?? (await requestHost());

  try {
    const client = createSerpdinoClient({ apiKey, revalidate });
    const projects = (await client.listProjects()).filter((project) => !project.type || project.type === 'serp');
    const project = pickProject(projects, { selectedId: requested ?? projectId, domain: siteDomain });

    if (!project) {
      return (
        <Shell title={title}>
          <Notice>There are no rank tracking projects in this SerpDino account yet.</Notice>
        </Shell>
      );
    }

    const rows = await getKeywordPositions(client, project._id, { startDate: daysAgo(days), ctrCurve });
    const switcher =
      !hideSwitcher && projects.length > 1 ? (
        <ProjectSelect param={param} value={project._id} projects={projects.map(toOption)} />
      ) : null;

    return (
      <Shell title={title} subtitle={project.domain} actions={switcher}>
        <Summary rows={rows} />
        {rows.length ? <PositionsTable rows={rows} /> : <Notice>No keywords are tracked in this project yet.</Notice>}
      </Shell>
    );
  } catch (error) {
    return (
      <Shell title={title}>
        <Notice tone="error">{describeError(error)}</Notice>
      </Shell>
    );
  }
}

// ----------------------------------------------------------------------

function Shell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="sdp">
      <header className="sdp-header">
        <div>
          <h1 className="sdp-title">{title}</h1>
          {subtitle && <p className="sdp-subtitle">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function Notice({ tone = 'info', children }: { tone?: 'info' | 'error'; children: ReactNode }) {
  return <p className={`sdp-notice sdp-notice-${tone}`}>{children}</p>;
}

function Summary({ rows }: { rows: KeywordPosition[] }) {
  const stats = summarize(rows);
  const items: [string, string | number][] = [
    ['Keywords', stats.keywords],
    ['Top 3', stats.top3],
    ['Top 10', stats.top10],
    ['Avg. position', stats.averagePosition ?? '—'],
    ['Est. clicks/mo', formatNumber(stats.estimatedClicks)],
    ['Up / down', `${stats.up} / ${stats.down}`],
  ];
  return (
    <dl className="sdp-summary">
      {items.map(([label, value]) => (
        <div key={label} className="sdp-stat">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PositionsTable({ rows }: { rows: KeywordPosition[] }) {
  const days = collectDays(rows);
  return (
    <div className="sdp-table-wrap">
      <table className="sdp-table">
        <thead>
          <tr>
            <th className="sdp-sticky">Keyword</th>
            <th>SERP</th>
            <th className="sdp-num">Volume</th>
            <th className="sdp-num" title="Estimated monthly clicks based on position and search volume">
              Est. clicks/mo
            </th>
            <th className="sdp-num">Position</th>
            <th className="sdp-num">Change</th>
            <th className="sdp-num">Best</th>
            <th>URL</th>
            {days.map((day) => (
              <th key={day} className="sdp-num sdp-day">
                {formatDay(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="sdp-sticky sdp-keyword">{row.keyword}</td>
              <td className="sdp-muted sdp-nowrap">{row.serp || '—'}</td>
              <td className="sdp-num">{formatNumber(row.volume)}</td>
              <td className="sdp-num">{formatNumber(row.estimatedClicks)}</td>
              <td className="sdp-num">
                <Position value={row.position} />
              </td>
              <td className="sdp-num">
                <Change value={row.change} />
              </td>
              <td className="sdp-num">{row.bestPosition ?? '—'}</td>
              <td className="sdp-url">
                {row.url ? (
                  <a href={row.url} target="_blank" rel="noopener noreferrer" title={row.url}>
                    {shortUrl(row.url)}
                  </a>
                ) : (
                  '—'
                )}
              </td>
              {days.map((day) => (
                <td key={day} className="sdp-num sdp-day">
                  {day in row.positionsByDay ? <Position value={row.positionsByDay[day]} /> : <span className="sdp-muted">·</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Position with a tint: top 3, top 10, not ranking. */
function Position({ value }: { value: number | null }) {
  if (value === null) return <span className="sdp-pos sdp-pos-none" title="Not in the checked results">—</span>;
  const tier = value <= 3 ? 'sdp-pos-top3' : value <= 10 ? 'sdp-pos-top10' : 'sdp-pos-rest';
  return <span className={`sdp-pos ${tier}`}>{value}</span>;
}

function Change({ value }: { value: number | null }) {
  if (value === null || value === 0) return <span className="sdp-change">—</span>;
  return (
    <span className={`sdp-change ${value > 0 ? 'sdp-up' : 'sdp-down'}`}>
      {value > 0 ? '▲' : '▼'} {Math.abs(value)}
    </span>
  );
}

// ----------------------------------------------------------------------

function toOption(project: SerpdinoProject) {
  return { id: project._id, label: project.domain && project.domain !== project.name ? `${project.domain} — ${project.name}` : project.name };
}

function describeError(error: unknown): string {
  if (error instanceof SerpdinoError) {
    if (error.planRequired) return 'API access needs a paid SerpDino plan. The Free plan has no API access.';
    if (error.status === 401) return `SerpDino rejected the API key: ${error.message}`;
    if (error.status === 429) return `SerpDino rate limit reached. Try again in ${error.retryAfter ?? 60} seconds.`;
    return error.message;
  }
  return 'Could not load positions from SerpDino.';
}

function formatNumber(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function formatDay(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/** Host of the current request (Next.js only), used to match the site's project when no domain is given. */
async function requestHost(): Promise<string | undefined> {
  try {
    // @ts-ignore -- next is a peer of the /next entry, not a dependency of the package
    const { headers } = await import('next/headers');
    const list = await headers();
    return list.get('x-forwarded-host') ?? list.get('host') ?? undefined;
  } catch {
    return undefined;
  }
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function daysAgo(days: number): string {
  const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function shortUrl(url: string): string {
  try {
    const { pathname, search } = new URL(url);
    return safeDecode(pathname + search) || '/';
  } catch {
    return url;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] || undefined : undefined;
}
