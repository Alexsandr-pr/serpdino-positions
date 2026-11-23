import type { ReactNode } from 'react';

import { createSerpdinoClient, SerpdinoError } from '../client.js';
import { normalizeDomain, pickProject } from '../project-match.js';
import { getKeywordPositions } from '../positions.js';
import type { SerpdinoProject } from '../types.js';

import { PositionsExplorer } from './positions-explorer.js';
import { ProjectSelect } from './project-select.js';

/** Choices of the period select, in days. */
export const PERIOD_OPTIONS = [7, 14, 30, 90, 180, 365];

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
  /** Default days of history, one column per checked day; the period select (`?days=`) overrides it. Default: 30. */
  days?: number;
  /**
   * Route handler that returns the results page of one check (export `GET` from
   * `@alex-pierierodov/serpdino-positions/next/route`). Default: "/api/serpdino/serp".
   */
  serpEndpoint?: string;
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
  serpEndpoint = '/api/serpdino/serp',
}: SerpdinoPositionsPageProps) {
  const params = (await searchParams) ?? {};
  const requested = firstValue(params[param]);
  const requestedDays = Number(firstValue(params.days));
  const period = PERIOD_OPTIONS.includes(requestedDays) ? requestedDays : days;
  const periodOptions = PERIOD_OPTIONS.includes(period) ? PERIOD_OPTIONS : [...PERIOD_OPTIONS, period].sort((a, b) => a - b);
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

    const rows = await getKeywordPositions(client, project._id, { startDate: daysAgo(period), ctrCurve });
    const switcher =
      !hideSwitcher && projects.length > 1 ? (
        <ProjectSelect
          param={param}
          value={project._id}
          projects={projects.map(toOption)}
          keep={period !== days ? { days: String(period) } : undefined}
        />
      ) : null;
    const ourDomains = [project.domain, ...(project.aliases ?? [])].map(normalizeDomain).filter(Boolean);

    return (
      <Shell title={title} subtitle={project.domain} actions={switcher}>
        {rows.length ? (
          <PositionsExplorer
            rows={rows}
            ourDomains={ourDomains}
            serpEndpoint={serpEndpoint}
            period={period}
            periodOptions={periodOptions}
            periodParam="days"
          />
        ) : (
          <Notice>No keywords are tracked in this project in the last {period} days.</Notice>
        )}
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

function env(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] || undefined : undefined;
}
