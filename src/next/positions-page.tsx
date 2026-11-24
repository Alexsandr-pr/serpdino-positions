import type { ReactNode } from 'react';

import { createSerpdinoClient, SerpdinoError } from '../client.js';
import { normalizeDomain, pickProject } from '../project-match.js';
import { memo } from '../memo.js';
import { getKeywordPositions, toCompetitorPositions } from '../positions.js';
import type { CompetitorPositions, Grouping, SerpdinoCapacity, SerpdinoPage, SerpdinoProject } from '../types.js';

import { PositionsExplorer } from './positions-explorer.js';
import { ProjectSelect } from './project-select.js';

/** Choices of the period select, in days. */
export const PERIOD_OPTIONS = [7, 14, 30, 90, 180, 365];
const GROUPS: Grouping[] = ['day', 'week', 'month'];
/** Long periods read better by week or month; an explicit ?group= wins. */
const defaultGroup = (days: number): Grouping => (days > 180 ? 'month' : days > 30 ? 'week' : 'day');

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
  const requestedGroup = firstValue(params.group) as Grouping | undefined;
  const group = requestedGroup && GROUPS.includes(requestedGroup) ? requestedGroup : defaultGroup(period);
  const fresh = firstValue(params.fresh) === '1';
  const siteDomain = domain ?? env('SERPDINO_SITE_DOMAIN') ?? (await requestHost());
  const ttl = revalidate ?? 3600;

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

    const competitors = (project.competitors ?? []).map(normalizeDomain).filter(Boolean);
    const requestedCompetitor = normalizeDomain(firstValue(params.competitor));
    const competitorDomain = competitors.includes(requestedCompetitor) ? requestedCompetitor : null;
    const startDate = daysAgo(period);
    const base = `${project._id}:${startDate}:${group}`;

    const [rows, competitorPositions, pages, capacity] = await Promise.all([
      memo(`rows:${base}`, ttl, () => getKeywordPositions(client, project._id, { startDate, ctrCurve, group }), { fresh }),
      competitorDomain
        ? memo(
            `competitor:${base}:${competitorDomain}`,
            ttl,
            async () => toCompetitorPositions(await client.getCompetitorPositions(project._id, competitorDomain, { startDate }, { cache: false }), group),
            { fresh }
          )
        : Promise.resolve<CompetitorPositions | null>(null),
      // Pages and capacity only add to the page: their failure must not break the table.
      memo(`pages:${project._id}`, ttl, async () => trimPages(await client.getPages(project._id)), { fresh }).catch(() => [] as SerpdinoPage[]),
      client.getCapacity().catch(() => null as SerpdinoCapacity | null),
    ]);

    const keep: Record<string, string> = {};
    if (period !== days) keep.days = String(period);
    if (requestedGroup && GROUPS.includes(requestedGroup)) keep.group = requestedGroup;
    const switcher =
      !hideSwitcher && projects.length > 1 ? (
        <ProjectSelect param={param} value={project._id} projects={projects.map(toOption)} keep={keep} />
      ) : null;
    const ourDomains = [project.domain, ...(project.aliases ?? [])].map(normalizeDomain).filter(Boolean);
    const refreshHref = `?${new URLSearchParams({ ...flatParams(params), fresh: '1' }).toString()}`;

    return (
      <Shell
        title={title}
        subtitle={project.domain}
        actions={switcher}
        info={<ProjectInfo project={project} capacity={capacity} refreshHref={refreshHref} />}
      >
        {rows.length ? (
          <PositionsExplorer
            rows={rows}
            pages={pages}
            ourDomains={ourDomains}
            serpEndpoint={serpEndpoint}
            period={period}
            periodOptions={periodOptions}
            group={group}
            competitors={competitors}
            competitor={competitorDomain && competitorPositions ? { domain: competitorDomain, positions: competitorPositions } : null}
            ctrCurve={ctrCurve}
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
  info,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  info?: ReactNode;
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
      {info}
      {children}
    </section>
  );
}

const FREQUENCIES: Record<string, string> = {
  daily: 'every day',
  every2days: 'every 2 days',
  every3days: 'every 3 days',
  weekly: 'every week',
  every2weeks: 'every 2 weeks',
  monthly: 'every month',
};

/** Check schedule, depth, last update and account capacity of the project. */
function ProjectInfo({
  project,
  capacity,
  refreshHref,
}: {
  project: SerpdinoProject;
  capacity: SerpdinoCapacity | null;
  refreshHref: string;
}) {
  const frequency = project.updateFrequency ? (FREQUENCIES[project.updateFrequency] ?? project.updateFrequency) : null;
  const time =
    typeof project.updateTime === 'number'
      ? ` at ${String(project.updateTime).padStart(2, '0')}:00${project.updateTimezone ? ` (${project.updateTimezone})` : ''}`
      : '';
  const items = [
    frequency && `Checked ${frequency}${time}`,
    project.serpTop && `Top ${project.serpTop}`,
    project.lastPositionUpdate && `Last update ${timeAgo(project.lastPositionUpdate)}`,
    project.competitors?.length && `${project.competitors.length} competitors`,
    capacity && `Account capacity ${capacity.booked.toLocaleString('en-US')} / ${capacity.total.toLocaleString('en-US')} keywords`,
  ].filter(Boolean) as string[];

  return (
    <div className="sdp-info">
      {items.map((item) => (
        <span key={item}>{item}</span>
      ))}
      <a className="sdp-info-refresh" href={refreshHref} title="Load fresh data from SerpDino">
        Refresh
      </a>
    </div>
  );
}

/** Only what the Pages tab shows (the API also returns weekly series and more). */
function trimPages(pages: SerpdinoPage[]): SerpdinoPage[] {
  return pages.map((page) => ({
    url: page.url,
    path: page.path,
    keywordCount: page.keywordCount,
    top10Count: page.top10Count,
    easyWinCount: page.easyWinCount,
    avgPosition: page.avgPosition,
    bestPosition: page.bestPosition,
    firstSeenAt: page.firstSeenAt,
    avgPositionTrend: (page.avgPositionTrend ?? []).map(({ date, avgPosition }) => ({ date, avgPosition })),
    keywords: (page.keywords ?? []).map(({ keywordId, bestPosition, latestPosition }) => ({ keywordId, bestPosition, latestPosition })),
  }));
}

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes)) return iso;
  if (minutes < 60) return `${Math.max(minutes, 1)} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Search params without the one-off refresh flag, for links back to the same view. */
function flatParams(params: SearchParams): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [name, value] of Object.entries(params)) {
    const first = firstValue(value);
    if (first !== undefined && name !== 'fresh') flat[name] = first;
  }
  return flat;
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
