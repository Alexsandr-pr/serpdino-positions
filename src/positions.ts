import type { SerpdinoClient } from './client.js';
import type {
  KeywordPosition,
  KeywordUpdatesOptions,
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
    const checks = (entry.updates ?? [])
      .filter((update) => update.status !== 'failed' && update.status !== 'error')
      .slice()
      .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

    const history = checks.map((update) => ({ date: update.date, position: positionOf(update.position) }));
    const positionsByDay: Record<string, number | null> = {};
    for (const point of history) positionsByDay[dayKey(point.date)] = point.position; // last check of a day wins

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
      url: latest?.position?.url ?? null,
      checkedAt: latest?.date ?? null,
      history,
      positionsByDay,
    };
  });

  return rows.sort((a, b) => {
    if (a.position === null && b.position !== null) return 1;
    if (b.position === null && a.position !== null) return -1;
    if (a.position !== null && b.position !== null && a.position !== b.position) return a.position - b.position;
    return a.keyword.localeCompare(b.keyword);
  });
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

function positionOf(result: { position?: number } | null | undefined): number | null {
  return typeof result?.position === 'number' && result.position > 0 ? result.position : null;
}

function dayKey(date: string): string {
  return new Date(date).toISOString().slice(0, 10);
}
