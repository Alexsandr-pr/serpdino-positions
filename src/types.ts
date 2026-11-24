// Shapes of the SerpDino REST API responses this package reads
// (https://serpdino.com/api-docs, OpenAPI: https://serpdino.com/api/openapi.json).
// Only the fields we use are typed; the API may return more.

export interface SerpdinoProject {
  _id: string;
  name: string;
  domain: string;
  aliases?: string[];
  competitors?: string[];
  folder?: string | null;
  updateFrequency?: string;
  serpTop?: number;
  /** Hour of the scheduled check, in updateTimezone. */
  updateTime?: number;
  updateTimezone?: string;
  lastPositionUpdate?: string;
  createdDate?: string;
  type?: 'serp' | 'local' | 'monitor';
  shared?: boolean;
}

export interface SerpdinoKeyword {
  _id: string;
  value: string;
  geoCode: string;
  langCode: string;
  avgMonthlySearches?: number | null;
  /** Monthly search volume by year. */
  volume?: { year: number; months: { month: number; value: number }[] }[];
}

export interface SerpdinoRankingResult {
  position: number;
  url?: string;
  title?: string;
  domain?: string;
}

export interface SerpdinoKeywordUpdate {
  _id: string;
  date: string;
  status: string;
  /** Missing or null when the domain does not rank in the scraped depth (top 50 or 100). */
  position?: SerpdinoRankingResult | null;
  /** Set when the results page had an AI Overview. */
  aiSerpId?: string | null;
  ourDomainInAiOverview?: boolean;
  /** How many of the site's URLs rank for the keyword at once. */
  cannibalizationCount?: number;
  /** With weekly / monthly aggregation: "W47 2026", "Nov 2026". */
  periodKey?: string;
  sampleCount?: number;
}

export interface SerpdinoKeywordUpdatesEntry {
  keyword: SerpdinoKeyword;
  updates: SerpdinoKeywordUpdate[];
}

export interface KeywordUpdatesOptions {
  /** YYYY-MM-DD, default: 30 days ago. */
  startDate?: string;
  /** YYYY-MM-DD, default: today. */
  endDate?: string;
  aggregation?: 'daily' | 'weekly' | 'monthly';
  search?: string;
  geoCode?: string;
  langCode?: string;
  sortBy?: 'keyword' | 'position' | 'volume';
  sortOrder?: 'asc' | 'desc';
}

export interface SerpdinoPage {
  _id?: string;
  url: string;
  path?: string;
  keywordCount: number;
  /** Keywords of the page in the top 10. */
  top10Count?: number;
  /** Keywords close to the top 10 (SerpDino "easy wins"). */
  easyWinCount?: number;
  avgPosition: number;
  bestPosition: number;
  firstSeenAt?: string;
  avgPositionTrend?: { date: string; avgPosition: number; keywordCount?: number }[];
  keywords: { keywordId: string; bestPosition: number | null; latestPosition: number | null; lastSeenAt?: string }[];
}

/** GET /api/projects/competitor-positions: the competitor's position per keyword check. */
export interface SerpdinoCompetitorEntry {
  keyword: SerpdinoKeyword;
  updates: SerpdinoKeywordUpdate[];
}

/** GET /api/user/capacity (only the fields shown). */
export interface SerpdinoCapacity {
  total: number;
  booked: number;
  available?: number;
  projects?: number;
  keywords?: number;
}

/** Columns of the table: one per day, ISO week (from Monday) or month. */
export type Grouping = 'day' | 'week' | 'month';

/** A competitor's positions by keyword id: the latest one and one per column. */
export type CompetitorPositions = Record<string, { latest: number | null; byKey: Record<string, number | null> }>;

export type SerpdinoMovement = { type: 'up' | 'down' | 'same' | 'new' | 'gone'; value: number | null };

/** One result of a Google results page as SerpDino saved it. */
export interface SerpdinoSerpResult {
  position: number;
  title?: string;
  domain?: string;
  url?: string;
  previousPosition?: number | null;
  movement?: SerpdinoMovement;
}

export interface SerpdinoAiOverviewResult {
  position: number;
  title?: string;
  domain?: string;
  url?: string;
  isOurDomain?: boolean;
}

/** GET /api/projects/position-history: the results page of one keyword check (top 30 + the site). */
export interface SerpdinoSerpSnapshot {
  keywordId: string;
  keywordValue: string;
  date: string;
  resultList: SerpdinoSerpResult[];
  /** Domains that were on the previous check and are gone now. */
  droppedDomains?: { domain: string; previousPosition: number | null; movement?: SerpdinoMovement }[];
  hasPreviousData?: boolean;
  aiOverviewResults?: SerpdinoAiOverviewResult[] | null;
  aiContainsOurDomain?: boolean;
}

/** One check of a keyword on a day: what the table cell shows and opens. */
export interface DayCheck {
  /** keyword-updates update _id: the keywordUpdateId of its results page. */
  updateId: string;
  date: string;
  position: number | null;
  url: string | null;
  aiOverview: boolean;
  ourDomainInAiOverview: boolean;
}

/** One row of the positions table, built from keyword-updates. */
export interface KeywordPosition {
  id: string;
  keyword: string;
  geoCode: string;
  langCode: string;
  /** "en-US", as SerpDino labels the SERP. */
  serp: string;
  volume: number | null;
  /** Estimated monthly clicks from the latest position and the volume (see estimateClicks). */
  estimatedClicks: number | null;
  /** Latest position, null when not ranking in the checked depth. */
  position: number | null;
  /** Position at the check before the latest one. */
  previousPosition: number | null;
  /** Positive = moved up (e.g. 12 → 9 is +3). Null when either side is missing. */
  change: number | null;
  bestPosition: number | null;
  url: string | null;
  checkedAt: string | null;
  /** Oldest first, for charts. */
  history: { date: string; position: number | null }[];
  /** Position per day, key YYYY-MM-DD (UTC). Days without a check are absent. */
  positionsByDay: Record<string, number | null>;
  /** The check behind each day, key YYYY-MM-DD (UTC). */
  checksByDay: Record<string, DayCheck>;
  /** The latest check (its results page opens from the Position column). */
  latestUpdateId: string | null;
  /** The latest results page had an AI Overview. */
  aiOverview: boolean;
  /** The site is cited in that AI Overview. */
  ourDomainInAiOverview: boolean;
  /** Site URLs ranking for the keyword at once on the latest check. */
  cannibalization: number;
  /** Monthly search volume, last 12 months, oldest first. */
  volumeTrend: number[];
  /** Google Ads competition index 0–100. */
  competition: number | null;
  cpcLow: number | null;
  cpcHigh: number | null;
}

/** Bulk keyword-volumes entry (compact names as returned by the API). */
export interface SerpdinoVolumeEntry {
  v?: string;
  g?: string;
  l?: string;
  /** Latest monthly volume. */
  lv?: number | null;
  /** Average monthly volume. */
  am?: number | null;
  /** Monthly trend, 12 values. */
  tr?: number[];
  ci?: number | null;
  cl?: number | null;
  ch?: number | null;
}
