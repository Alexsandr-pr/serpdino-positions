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
  url: string;
  path: string;
  keywordCount: number;
  avgPosition: number;
  bestPosition: number;
  keywords: { keywordId: string; value: string; position: number }[];
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
