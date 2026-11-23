import type {
  KeywordUpdatesOptions,
  SerpdinoKeywordUpdatesEntry,
  SerpdinoPage,
  SerpdinoProject,
  SerpdinoSerpSnapshot,
  SerpdinoVolumeEntry,
} from './types.js';

export const DEFAULT_BASE_URL = 'https://serpdino.com';
/** Rankings update at most daily, so an hour of caching is plenty. */
export const DEFAULT_REVALIDATE_SECONDS = 3600;

export interface SerpdinoClientOptions {
  /** API key (sd_…). Defaults to process.env.SERPDINO_API_KEY. Keep it server-side only. */
  apiKey?: string;
  /** Default: process.env.SERPDINO_BASE_URL or https://serpdino.com. */
  baseUrl?: string;
  /**
   * Seconds to cache GET responses in the Next.js data cache (`fetch(…, { next: { revalidate } })`).
   * Ignored outside Next.js. `0` disables caching. Default: 3600.
   */
  revalidate?: number;
  /** Custom fetch (tests, proxies). Default: global fetch. */
  fetch?: typeof fetch;
}

/** Any non-2xx response or `success: false` from the API. */
export class SerpdinoError extends Error {
  readonly status: number;
  /** True when the account is on the Free plan, which has no API access. */
  readonly planRequired: boolean;
  /** Seconds to wait after HTTP 429. */
  readonly retryAfter: number | null;

  constructor(
    message: string,
    { status, planRequired = false, retryAfter = null }: { status: number; planRequired?: boolean; retryAfter?: number | null }
  ) {
    super(message);
    this.name = 'SerpdinoError';
    this.status = status;
    this.planRequired = planRequired;
    this.retryAfter = retryAfter;
  }
}

type Query = Record<string, string | number | undefined>;

export interface SerpdinoClient {
  listProjects(): Promise<SerpdinoProject[]>;
  getProject(projectId: string): Promise<SerpdinoProject & { keywords?: unknown[] }>;
  /** Keyword positions with dated checks, keyed by keyword ID. Default range: last 30 days. */
  getKeywordUpdates(projectId: string, options?: KeywordUpdatesOptions): Promise<Record<string, SerpdinoKeywordUpdatesEntry>>;
  /** Search volume per keyword ID (bulk mode, compact field names). */
  getKeywordVolumes(projectId: string): Promise<Record<string, SerpdinoVolumeEntry>>;
  /** Ranking pages with average position, worst first. */
  getPages(projectId: string): Promise<SerpdinoPage[]>;
  /** The Google results page saved by one keyword check (top 30 plus the site), with AI Overview. */
  getSerpSnapshot(keywordUpdateId: string): Promise<SerpdinoSerpSnapshot>;
  /** Raw GET for endpoints not wrapped here, e.g. `get('/api/user/capacity')`. */
  get<T = unknown>(path: string, query?: Query): Promise<T>;
}

/**
 * Read-only SerpDino API client. Server-side only: it sends your API key.
 *
 * ```js
 * const serpdino = createSerpdinoClient(); // reads SERPDINO_API_KEY
 * const projects = await serpdino.listProjects();
 * ```
 */
export function createSerpdinoClient(options: SerpdinoClientOptions = {}): SerpdinoClient {
  const apiKey = options.apiKey ?? readEnv('SERPDINO_API_KEY');
  const baseUrl = (options.baseUrl ?? readEnv('SERPDINO_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const revalidate = options.revalidate ?? DEFAULT_REVALIDATE_SECONDS;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  if (typeof window !== 'undefined') {
    throw new Error('serpdino-positions: the API client must run on the server, it would expose your API key.');
  }

  async function get<T>(path: string, query: Query = {}): Promise<T> {
    if (!apiKey) {
      throw new SerpdinoError('SerpDino API key is missing. Set SERPDINO_API_KEY or pass { apiKey }.', { status: 401 });
    }

    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }

    const init: RequestInit & { next?: { revalidate: number } } = {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    };
    if (revalidate > 0) init.next = { revalidate };
    else init.cache = 'no-store';

    const response = await fetchImpl(url, init);
    const body = await response.json().catch(() => null);

    if (!response.ok || body?.success === false) {
      const retryHeader = response.headers.get('retry-after');
      throw new SerpdinoError(body?.message || `SerpDino API request failed with HTTP ${response.status}`, {
        status: response.status,
        planRequired: Boolean(body?.planRequired),
        retryAfter: body?.retryAfter ?? (retryHeader ? Number(retryHeader) : null),
      });
    }
    return body as T;
  }

  return {
    get,
    async listProjects() {
      const body = await get<{ projects?: SerpdinoProject[] }>('/api/projects');
      return body.projects ?? [];
    },
    async getProject(projectId) {
      const body = await get<{ project: SerpdinoProject }>(`/api/projects/${encodeURIComponent(projectId)}`);
      return body.project;
    },
    async getKeywordUpdates(projectId, opts = {}) {
      const body = await get<{ data?: Record<string, SerpdinoKeywordUpdatesEntry> }>('/api/projects/keyword-updates', {
        projectId,
        ...opts,
      });
      return body.data ?? {};
    },
    async getKeywordVolumes(projectId) {
      const body = await get<{ data?: Record<string, SerpdinoVolumeEntry> }>('/api/projects/keyword-volumes', { projectId });
      return body.data ?? {};
    },
    async getSerpSnapshot(keywordUpdateId) {
      const body = await get<{ data: SerpdinoSerpSnapshot }>('/api/projects/position-history', { keywordUpdateId });
      return body.data;
    },
    async getPages(projectId) {
      const body = await get<{ data?: SerpdinoPage[] }>('/api/projects/pages', { projectId });
      return body.data ?? [];
    },
  };
}

function readEnv(name: string): string | undefined {
  return typeof process !== 'undefined' ? process.env?.[name] : undefined;
}
