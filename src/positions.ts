import type { SerpdinoClient } from './client.js';
import type {
  DayCheck,
  KeywordPosition,
  KeywordUpdatesOptions,
  SerpdinoKeyword,
  SerpdinoKeywordUpdate,
  SerpdinoKeywordUpdatesEntry,
  SerpdinoVolumeEntry,
} from './types.js';

/**
 * Share of searches that click a result at positions 1–20 (index 0 = position 1).
 * SerpDino shows "Est. clicks/mo" but does not publish its curve, so this is a common
 * industry average; numbers will be close to, not equal to, the SerpDino dashboard.
 * Pass your own curve to `estimateClicks` / `toKeywordPositions` if you have one.
 */
export const DEFAULT_CTR_CURVE = [
  0.28, 0.15, 0.11, 0.08, 0.07, 0.05, 0.04, 0.03, 0.025, 0.02, 0.012, 0.011, 0.01, 0.009, 0.008, 0.007, 0.006, 0.005,
  0.005, 0.004,
];

/** Estimated monthly clicks: volume × CTR of the position. 0 below the curve, null without data. */
export function estimateClicks(
  position: number | null,
  volume: number | null,
  ctrCurve: number[] = DEFAULT_CTR_CURVE
): number | null {
  if (position === null || volume === null) return null;
  const ctr = ctrCurve[position - 1] ?? 0;
  return Math.round(volume * ctr);
}

export interface ToKeywordPositionsOptions {
  /** Bulk keyword-volumes map; fills the volume when keyword-updates has none. */
  volumes?: Record<string, SerpdinoVolumeEntry>;
  ctrCurve?: number[];
}

/**
 * Turns the keyword-updates map into table rows: latest position, change since the previous
 * check, best position, estimated clicks and a position for every checked day. Failed checks are skipped.
 * Rows are sorted by position (ranking first, best first), then by keyword.
 */
export function toKeywordPositions(
  data: Record<string, SerpdinoKeywordUpdatesEntry>,
  { volumes = {}, ctrCurve = DEFAULT_CTR_CURVE }: ToKeywordPositionsOptions = {}
): KeywordPosition[] {
  const rows = Object.entries(data).map(([id, entry]): KeywordPosition => {
    const keywordId = entry.keyword?._id ?? id;
    // Only finished checks: one still "processing" has no position yet and would read as "not ranking".
    const checks = (entry.updates ?? [])
      .filter(isFinishedCheck)
      .slice()
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const history = checks.map((update) => ({ date: update.date, position: positionOf(update.position) }));
    const positionsByDay: Record<string, number | null> = {};
    const checksByDay: Record<string, DayCheck> = {};
    for (const update of checks) {
      const day = dayKey(update.date); // the last check of a day wins
      const check = toDayCheck(update);
      positionsByDay[day] = check.position;
      checksByDay[day] = check;
    }

    const latest = checks.at(-1);
    const previous = checks.at(-2);
    const position = latest ? positionOf(latest.position) : null;
    const previousPosition = previous ? positionOf(previous.position) : null;
    const ranked = history.map((point) => point.position).filter((value): value is number => value !== null);

    const volumeEntry = volumes[keywordId] ?? volumes[id];
    const volume = entry.keyword?.avgMonthlySearches ?? volumeEntry?.lv ?? volumeEntry?.am ?? null;
    const geoCode = entry.keyword?.geoCode ?? volumeEntry?.g ?? '';
    const langCode = entry.keyword?.langCode ?? volumeEntry?.l ?? '';

    return {
      id: keywordId,
      keyword: entry.keyword?.value ?? volumeEntry?.v ?? '',
      geoCode,
      langCode,
      serp: [langCode, geoCode].filter(Boolean).join('-'),
      volume,
      estimatedClicks: estimateClicks(position, volume, ctrCurve),
      position,
      previousPosition,
      change: position !== null && previousPosition !== null ? previousPosition - position : null,
      bestPosition: ranked.length ? Math.min(...ranked) : null,
      url: latest ? validUrl(latest.position?.url) : null,
      checkedAt: latest?.date ?? null,
      history,
      positionsByDay,
      checksByDay,
      latestUpdateId: latest?._id ?? null,
      aiOverview: Boolean(latest?.aiSerpId),
      ourDomainInAiOverview: Boolean(latest?.ourDomainInAiOverview),
      cannibalization: latest?.cannibalizationCount ?? 0,
      volumeTrend: volumeEntry?.tr?.length ? volumeEntry.tr.slice(-12) : monthlyVolumes(entry.keyword),
      competition: volumeEntry?.ci ?? null,
      cpcLow: volumeEntry?.cl ?? null,
      cpcHigh: volumeEntry?.ch ?? null,
    };
  });

  return rows.sort((a, b) => {
    if (a.position === null && b.position !== null) return 1;
    if (b.position === null && a.position !== null) return -1;
    if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
    return a.keyword.localeCompare(b.keyword);
  });
}

/** Colour bands of a Google position, best to worst. */
export const POSITION_TIERS = ['top1', 'top3', 'top5', 'top10', 'top20', 'top50', 'rest'] as const;
export type PositionTier = (typeof POSITION_TIERS)[number] | 'none';

/** The colour band of a position: 1, 2–3, 4–5, 6–10, 11–20, 21–50, 51+, or "none" when not ranked. */
export function positionTier(position: number | null): PositionTier {
  if (position === null) return 'none';
  if (position <= 1) return 'top1';
  if (position <= 3) return 'top3';
  if (position <= 5) return 'top5';
  if (position <= 10) return 'top10';
  if (position <= 20) return 'top20';
  if (position <= 50) return 'top50';
  return 'rest';
}

/** Every checked day across the rows, newest first (YYYY-MM-DD) — the date columns of the table. */
export function collectDays(rows: KeywordPosition[]): string[] {
  const days = new Set<string>();
  for (const row of rows) for (const day of Object.keys(row.positionsByDay)) days.add(day);
  return [...days].sort().reverse();
}

/** Fetches positions and volumes for a project and returns table rows. */
export async function getKeywordPositions(
  client: SerpdinoClient,
  projectId: string,
  options?: KeywordUpdatesOptions & { ctrCurve?: number[] }
): Promise<KeywordPosition[]> {
  const { ctrCurve, ...query } = options ?? {};
  const [updates, volumes] = await Promise.all([
    client.getKeywordUpdates(projectId, query),
    // Volumes only fill gaps, so a failure here must not break the table.
    client.getKeywordVolumes(projectId).catch(() => ({})),
  ]);
  return toKeywordPositions(updates, { volumes, ctrCurve });
}

/** Short summary for a project header. */
export function summarize(rows: KeywordPosition[]) {
  const ranked = rows.filter((row) => row.position !== null) as (KeywordPosition & { position: number })[];
  return {
    keywords: rows.length,
    top3: ranked.filter((row) => row.position <= 3).length,
    top10: ranked.filter((row) => row.position <= 10).length,
    up: rows.filter((row) => (row.change ?? 0) > 0).length,
    down: rows.filter((row) => (row.change ?? 0) < 0).length,
    averagePosition: ranked.length
      ? Math.round((ranked.reduce((sum, row) => sum + row.position, 0) / ranked.length) * 10) / 10
      : null,
    estimatedClicks: rows.reduce((sum, row) => sum + (row.estimatedClicks ?? 0), 0),
  };
}

function isFinishedCheck(update: SerpdinoKeywordUpdate): boolean {
  return !update.status || update.status === 'success';
}

function toDayCheck(update: SerpdinoKeywordUpdate): DayCheck {
  return {
    updateId: update._id,
    date: update.date,
    position: positionOf(update.position),
    url: validUrl(update.position?.url),
    aiOverview: Boolean(update.aiSerpId),
    ourDomainInAiOverview: Boolean(update.ourDomainInAiOverview),
  };
}

/** SerpDino writes "-" for "no URL". */
function validUrl(url: string | undefined): string | null {
  return url && /^https?:\/\//.test(url) ? url : null;
}

/** Last 12 monthly volumes from the keyword's volume history, oldest first. */
function monthlyVolumes(keyword: SerpdinoKeyword | undefined): number[] {
  const months = (keyword?.volume ?? [])
    .flatMap(({ year, months }) => months.map(({ month, value }) => ({ key: year * 12 + month, value })))
    .sort((a, b) => a.key - b.key);
  return months.slice(-12).map((month) => month.value);
}

function positionOf(result: { position?: number } | null | undefined): number | null {
  return typeof result?.position === 'number' && result.position > 0 ? result.position : null;
}

function dayKey(date: string): string {
  return new Date(date).toISOString().slice(0, 10);
}
