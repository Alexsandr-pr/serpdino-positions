import { createSerpdinoClient, SerpdinoError } from '../client.js';

/** A saved results page never changes, so it can be cached for a day. */
const SNAPSHOT_REVALIDATE_SECONDS = 86400;
const UPDATE_ID = /^[a-f0-9]{24}$/i;

/**
 * Route handler behind the results page popup: the browser asks it for one keyword check,
 * and it calls SerpDino with the API key, which stays on the server.
 *
 * ```js
 * // app/api/serpdino/serp/route.js
 * export { GET } from '@alex-pierierodov/serpdino-positions/next/route';
 * ```
 */
export async function GET(request: Request): Promise<Response> {
  const keywordUpdateId = new URL(request.url).searchParams.get('keywordUpdateId') ?? '';
  if (!UPDATE_ID.test(keywordUpdateId)) {
    return json({ error: 'keywordUpdateId is required.' }, 400);
  }

  try {
    const client = createSerpdinoClient({ revalidate: SNAPSHOT_REVALIDATE_SECONDS });
    const data = await client.getSerpSnapshot(keywordUpdateId);
    return json({ data }, 200, { 'Cache-Control': 'private, max-age=3600' });
  } catch (error) {
    if (error instanceof SerpdinoError) {
      return json({ error: error.message }, error.status >= 400 && error.status < 600 ? error.status : 502);
    }
    return json({ error: 'Could not load the results page from SerpDino.' }, 502);
  }
}

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'X-Robots-Tag': 'noindex', ...headers } });
}
