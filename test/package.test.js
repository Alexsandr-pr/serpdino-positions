import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  checkBasicAuth,
  collectDays,
  createSerpdinoClient,
  estimateClicks,
  findProjectByDomain,
  normalizeDomain,
  pickProject,
  positionTier,
  bucketKey,
  toCompetitorPositions,
  visibilityByKey,
  memo,
  SerpdinoError,
  summarize,
  toKeywordPositions,
} from '../dist/index.js';

// Shapes copied from https://serpdino.com/api-docs (keyword-updates example).
const KEYWORD_UPDATES = {
  kw1: {
    keyword: { _id: 'kw1', value: 'seo tools', geoCode: 'US', langCode: 'en', avgMonthlySearches: 8100 },
    updates: [
      { _id: 'u5', date: '2025-01-17T12:00:00.000Z', status: 'processing' },
      { _id: 'u2', date: '2025-01-16T12:00:00.000Z', status: 'success', position: { position: 9, url: 'https://example.com/seo-tools' }, aiSerpId: 'ai1', ourDomainInAiOverview: true, cannibalizationCount: 2 },
      { _id: 'u1', date: '2025-01-15T12:00:00.000Z', status: 'success', position: { position: 12, url: 'https://example.com/seo-tools' } },
    ],
  },
  kw2: {
    keyword: { _id: 'kw2', value: 'rank tracker', geoCode: 'US', langCode: 'en' },
    updates: [
      { _id: 'u3', date: '2025-01-15T12:00:00.000Z', status: 'success', position: { position: 4 } },
      { _id: 'u4', date: '2025-01-16T12:00:00.000Z', status: 'success', position: null },
    ],
  },
};

const PROJECTS = [
  { _id: 'p1', name: 'Acme', domain: 'acme.com', aliases: [] },
  { _id: 'p2', name: 'Blog', domain: 'blog.example.com', aliases: ['example.org'] },
];

test('toKeywordPositions: latest, change, best, history, sorting', () => {
  const rows = toKeywordPositions(KEYWORD_UPDATES);
  assert.equal(rows[0].keyword, 'seo tools');
  assert.equal(rows[0].position, 9);
  assert.equal(rows[0].previousPosition, 12);
  assert.equal(rows[0].change, 3);
  assert.equal(rows[0].bestPosition, 9);
  assert.equal(rows[0].volume, 8100);
  assert.deepEqual(rows[0].history.map((point) => point.position), [12, 9]);
  assert.equal(rows[0].serp, 'en-US');
  assert.equal(rows[0].estimatedClicks, Math.round(8100 * 0.025));
  assert.deepEqual(rows[0].positionsByDay, { '2025-01-15': 12, '2025-01-16': 9 });

  assert.equal(rows[1].keyword, 'rank tracker');
  assert.equal(rows[1].position, null);
  assert.equal(rows[1].change, null);
  assert.equal(rows[1].bestPosition, 4);

  assert.deepEqual(rows[1].positionsByDay, { '2025-01-15': 4, '2025-01-16': null });
  assert.deepEqual(collectDays(rows), ['2025-01-16', '2025-01-15']);
  assert.deepEqual(summarize(rows), {
    keywords: 2, top3: 0, top10: 1, up: 1, down: 0, averagePosition: 9, estimatedClicks: 203,
  });
});

test('volumes from keyword-volumes fill the gap; clicks estimate', () => {
  const rows = toKeywordPositions(KEYWORD_UPDATES, { volumes: { kw2: { lv: 2400 } } });
  const tracker = rows.find((row) => row.keyword === 'rank tracker');
  assert.equal(tracker.volume, 2400);
  assert.equal(tracker.estimatedClicks, null); // not ranking now
  assert.equal(estimateClicks(1, 1000), 280);
  assert.equal(estimateClicks(45, 1000), 0);
  assert.equal(estimateClicks(3, null), null);
});

test('domain matching ignores protocol, www and path; aliases count', () => {
  assert.equal(normalizeDomain('https://www.Acme.com/admin?x=1'), 'acme.com');
  assert.equal(findProjectByDomain(PROJECTS, 'www.acme.com')?._id, 'p1');
  assert.equal(findProjectByDomain(PROJECTS, 'https://example.org')?._id, 'p2');
  assert.equal(findProjectByDomain(PROJECTS, 'other.com'), null);
});

test('pickProject: explicit choice, then domain, then first', () => {
  assert.equal(pickProject(PROJECTS, { selectedId: 'p2', domain: 'acme.com' })?._id, 'p2');
  assert.equal(pickProject(PROJECTS, { selectedId: 'missing', domain: 'example.org' })?._id, 'p2');
  assert.equal(pickProject(PROJECTS, { domain: 'unknown.com' })?._id, 'p1');
  assert.equal(pickProject([], {}), null);
});

test('client sends the bearer key and parses projects', async () => {
  const calls = [];
  const client = createSerpdinoClient({
    apiKey: 'sd_test',
    fetch: async (url, init) => {
      calls.push({ url: String(url), init });
      return Response.json({ success: true, projects: PROJECTS });
    },
  });
  const projects = await client.listProjects();
  assert.equal(projects.length, 2);
  assert.equal(calls[0].url, 'https://serpdino.com/api/projects');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer sd_test');
  assert.deepEqual(calls[0].init.next, { revalidate: 3600 });
});

test('client builds keyword-updates query', async () => {
  let called;
  const client = createSerpdinoClient({
    apiKey: 'sd_test',
    fetch: async (url) => {
      called = new URL(url);
      return Response.json({ success: true, data: KEYWORD_UPDATES });
    },
  });
  const data = await client.getKeywordUpdates('p1', { startDate: '2025-01-01', search: '' });
  assert.equal(called.pathname, '/api/projects/keyword-updates');
  assert.equal(called.searchParams.get('projectId'), 'p1');
  assert.equal(called.searchParams.get('startDate'), '2025-01-01');
  assert.equal(called.searchParams.has('search'), false);
  assert.ok(data.kw1);
});

test('client turns API errors into SerpdinoError', async () => {
  const client = createSerpdinoClient({
    apiKey: 'sd_test',
    fetch: async () => Response.json({ message: 'The Free plan does not include API access', planRequired: true }, { status: 403 }),
  });
  await assert.rejects(client.listProjects(), (error) => {
    assert.ok(error instanceof SerpdinoError);
    assert.equal(error.status, 403);
    assert.equal(error.planRequired, true);
    return true;
  });

  const noKey = createSerpdinoClient({ apiKey: '', fetch: async () => Response.json({}) });
  await assert.rejects(noKey.listProjects(), /API key is missing/);
});

test('basic auth: refuses without password, accepts the right one', () => {
  const request = (auth) => new Request('https://site.com/admin', auth ? { headers: { authorization: auth } } : {});
  const basic = (user, password) => `Basic ${btoa(`${user}:${password}`)}`;

  assert.equal(checkBasicAuth(request(), { password: 'secret' })?.status, 401);
  assert.equal(checkBasicAuth(request(basic('admin', 'wrong')), { password: 'secret' })?.status, 401);
  assert.equal(checkBasicAuth(request(basic('admin', 'secret')), { password: 'secret' }), null);
  assert.equal(checkBasicAuth(request(basic('admin', 'secret')), { password: '' })?.status, 401);
});

test('positionTier: colour band of each position', () => {
  const cases = [[1, 'top1'], [2, 'top3'], [3, 'top3'], [4, 'top5'], [5, 'top5'], [6, 'top10'], [10, 'top10'],
    [11, 'top20'], [20, 'top20'], [21, 'top50'], [50, 'top50'], [51, 'rest'], [100, 'rest'], [null, 'none']];
  for (const [position, tier] of cases) assert.equal(positionTier(position), tier, `position ${position}`);
});

test('rows: processing checks skipped, checks by day, AI Overview, volume trend and CPC', () => {
  const rows = toKeywordPositions(KEYWORD_UPDATES, {
    volumes: { kw1: { tr: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], ci: 40, cl: 0.5, ch: 2.25 } },
  });
  const seo = rows.find((row) => row.keyword === 'seo tools');
  assert.equal(seo.position, 9); // the processing check of Jan 17 does not count
  assert.equal(seo.latestUpdateId, 'u2');
  assert.deepEqual(Object.keys(seo.checksByDay).sort(), ['2025-01-15', '2025-01-16']);
  assert.deepEqual(seo.checksByDay['2025-01-16'], {
    updateId: 'u2', date: '2025-01-16T12:00:00.000Z', position: 9, url: 'https://example.com/seo-tools',
    aiOverview: true, ourDomainInAiOverview: true,
  });
  assert.equal(seo.aiOverview, true);
  assert.equal(seo.ourDomainInAiOverview, true);
  assert.equal(seo.cannibalization, 2);
  assert.deepEqual(seo.volumeTrend, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(seo.competition, 40);
  assert.equal(seo.cpcHigh, 2.25);

  const tracker = rows.find((row) => row.keyword === 'rank tracker');
  assert.equal(tracker.checksByDay['2025-01-16'].position, null);
  assert.equal(tracker.aiOverview, false);
});

test('client loads the results page of a check', async () => {
  let called;
  const client = createSerpdinoClient({
    apiKey: 'sd_test',
    fetch: async (url) => {
      called = new URL(url);
      return Response.json({ success: true, data: { keywordId: 'kw1', keywordValue: 'seo tools', date: '2025-01-16', resultList: [{ position: 1, domain: 'a.com' }] } });
    },
  });
  const snapshot = await client.getSerpSnapshot('u2');
  assert.equal(called.pathname, '/api/projects/position-history');
  assert.equal(called.searchParams.get('keywordUpdateId'), 'u2');
  assert.equal(snapshot.resultList[0].domain, 'a.com');
});

test('results page route refuses a missing or malformed id', async () => {
  const { GET } = await import('../dist/next/route.js');
  assert.equal((await GET(new Request('https://site.com/api/serpdino/serp'))).status, 400);
  assert.equal((await GET(new Request('https://site.com/api/serpdino/serp?keywordUpdateId=../projects'))).status, 400);
});

test('bucketKey: day, ISO week from Monday, month', () => {
  assert.equal(bucketKey('2026-11-23T21:52:20.894Z'), '2026-11-23');
  assert.equal(bucketKey('2026-11-23T21:52:20.894Z', 'week'), '2026-11-23'); // a Monday
  assert.equal(bucketKey('2026-11-22T08:00:00.000Z', 'week'), '2026-11-16'); // Sunday → its Monday
  assert.equal(bucketKey('2026-11-22T08:00:00.000Z', 'month'), '2026-11-01');
});

test('competitor positions by keyword and column; 0 means not ranking', () => {
  const positions = toCompetitorPositions({
    kw1: {
      keyword: { _id: 'kw1', value: 'seo tools', geoCode: 'US', langCode: 'en' },
      updates: [
        { _id: 'a', date: '2025-01-15T12:00:00.000Z', status: 'success', position: { position: 4 } },
        { _id: 'b', date: '2025-01-16T12:00:00.000Z', status: 'success', position: { position: 0 } },
        { _id: 'c', date: '2025-01-17T12:00:00.000Z', status: 'processing' },
      ],
    },
  });
  assert.deepEqual(positions.kw1, { latest: null, byKey: { '2025-01-15': 4, '2025-01-16': null } });
});

test('visibility: clicks and average position per column, unchecked rows skipped', () => {
  const rows = toKeywordPositions(KEYWORD_UPDATES);
  const series = visibilityByKey(rows, ['2025-01-15', '2025-01-16'], (row, key) =>
    key in row.checksByDay ? row.checksByDay[key].position : undefined
  );
  assert.deepEqual(series[0], { key: '2025-01-15', clicks: Math.round(8100 * 0.011), averagePosition: 8, checked: 2 });
  assert.equal(series[1].averagePosition, 9);
  assert.equal(series[1].checked, 2);
});

test('memo: one load per key until it expires, fresh reloads', async () => {
  let loads = 0;
  const load = async () => ++loads;
  assert.equal(await memo('k', 60, load), 1);
  assert.equal(await memo('k', 60, load), 1);
  assert.equal(await memo('k', 60, load, { fresh: true }), 2);
  assert.equal(await memo('k', 0, load), 3); // no caching
});

test('styles: media queries intact, hover never changes the table', () => {
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.equal((css.match(/{/g) ?? []).length, (css.match(/}/g) ?? []).length);
  assert.match(css, /@media \(prefers-color-scheme: dark\) {\s*:root:not\(\[data-theme='light'\]\) \.sdp {/);
  assert.match(css, /@media \(max-width: 600px\) {/);
  const hoverRules = css.split('}').filter((rule) => rule.includes(':hover'));
  for (const rule of hoverRules) assert.match(rule, /\.sdp \.sdp-table tbody tr:hover/, rule);
});
