# @alex-pierierodov/serpdino-positions

Show your [SerpDino](https://serpdino.com) Google rankings inside your own site's admin.

- A ready Next.js admin page: keywords, SERP (language-country), search volume and its 12-month trend, position history, estimated clicks, CPC, competition, current position, change, best position, ranking URL and a column for every checked day, coloured by position band.
- Interactive: search (`-word` excludes), filter tiles (top 3, top 10, 11–50, not ranking, up, down, AI Overview, cited in AI), sorting by any column including days, period select (7–365 days), SERP select, column toggles, CSV export.
- Click any position to see the Google results page that check saved: top 30 with movement, the AI Overview, your site highlighted, domains that dropped out; step through checks with ← →.
- Opens the project of the current site automatically (matched by domain) and has a site switcher for every project in the account.
- Server-side SerpDino API client with caching, usable outside Next.js.
- Optional Basic Auth guard for the admin route.

Unofficial package built on the public [SerpDino REST API](https://serpdino.com/api-docs). API access needs a paid SerpDino plan.

## Install

```bash
npm i @alex-pierierodov/serpdino-positions
```

## Set up a site (Next.js App Router)

1. Add the API key to the site's environment. Create it in SerpDino → Settings → API Keys.

```bash
SERPDINO_API_KEY=sd_your_key_here
# Optional: which SerpDino project is this site. Without it the request's Host header is used.
SERPDINO_SITE_DOMAIN=example.com
```

2. Add the page, e.g. `app/admin/positions/page.js`:

```js
import { SerpdinoPositionsPage } from '@alex-pierierodov/serpdino-positions/next';
import '@alex-pierierodov/serpdino-positions/styles.css';

export const metadata = { robots: { index: false, follow: false } };

export default function Page({ searchParams }) {
  return <SerpdinoPositionsPage searchParams={searchParams} />;
}
```

3. Add the route handler behind the results page popup, e.g. `app/api/serpdino/serp/route.js`. It keeps the API key on the server:

```js
export { GET } from '@alex-pierierodov/serpdino-positions/next/route';
```

With another path (or `trailingSlash: true`), pass it to the page: `<SerpdinoPositionsPage serpEndpoint="/api/serpdino/serp/" … />`.

4. Close the admin route. With your own auth, put the page behind it. Otherwise use the built-in Basic Auth in `proxy.js` (Next.js 16) or `middleware.js` (Next.js 15 and earlier):

```js
import { checkBasicAuth } from '@alex-pierierodov/serpdino-positions';

export function proxy(request) {
  // user: SERPDINO_ADMIN_USER (default "admin"), password: SERPDINO_ADMIN_PASSWORD
  return checkBasicAuth(request) ?? undefined;
}

export const config = { matcher: ['/admin/:path*'] };
```

Without `SERPDINO_ADMIN_PASSWORD` every request to the matched routes is refused, so the page is never left open by mistake.

## Which project is shown

1. The project picked in the site switcher (`?project=<id>`).
2. The `projectId` prop.
3. The project whose domain or alias equals the site domain: the `domain` prop, `SERPDINO_SITE_DOMAIN`, or the request host. `www.`, protocol and path are ignored.
4. The first project in the account.

Only rank tracking projects are listed (not Google Maps grid or page monitor projects).

## Page props

| Prop | Default | |
|---|---|---|
| `searchParams` | — | Pass the page's `searchParams`; needed for the site switcher. |
| `apiKey` | `SERPDINO_API_KEY` | API key. Server-side only. |
| `domain` | `SERPDINO_SITE_DOMAIN`, then request host | Site domain used to pick its project. |
| `projectId` | — | Always open this project first. |
| `hideSwitcher` | `false` | Hide the site switcher. |
| `days` | `30` | Default days of history; the period select (`?days=`) overrides it. |
| `serpEndpoint` | `"/api/serpdino/serp"` | Route handler of the results page popup. |
| `revalidate` | `3600` | Seconds to cache API responses. `0` disables caching. |
| `ctrCurve` | built-in | CTR per position for the clicks estimate (index 0 = position 1). |
| `title` | `"Google positions"` | Page heading. |
| `param` | `"project"` | Query parameter of the switcher. |

### Estimated clicks

`Est. clicks/mo = search volume × CTR of the current position`. SerpDino shows a similar column but does not publish its CTR curve, so the package uses a common industry average (28% for position 1, 15% for 2, 11% for 3 … 0 below 20). Numbers are close to the dashboard, not identical. Pass `ctrCurve` to use your own.

## Styling

All classes start with `sdp-`. Override the variables on `.sdp`:

```css
.sdp {
  --sdp-accent: #d4541a;
  --sdp-radius: 0;
  --sdp-font: 'Inter', sans-serif;
}
```

Dark colors apply with `prefers-color-scheme: dark`, `[data-theme='dark']` or `.dark` on an ancestor.

## API client (any Node.js server)

```js
import { createSerpdinoClient, getKeywordPositions, SerpdinoError } from '@alex-pierierodov/serpdino-positions';

const serpdino = createSerpdinoClient({ apiKey: process.env.SERPDINO_API_KEY });

const projects = await serpdino.listProjects();
const rows = await getKeywordPositions(serpdino, projects[0]._id, { startDate: '2026-11-01' });
// rows[i]: { keyword, serp, volume, estimatedClicks, position, change, bestPosition, url, positionsByDay, … }
```

Client methods: `listProjects`, `getProject`, `getKeywordUpdates`, `getKeywordVolumes`, `getSerpSnapshot` (results page of one check), `getPages`, and `get(path, query)` for any other read endpoint. API errors throw `SerpdinoError` with `status`, `planRequired` and `retryAfter`.

The client refuses to run in the browser: never ship the API key to the client.

## Development

```bash
npm install
npm test        # builds and runs the tests
npm publish     # first publish: npm publish --access public
```

## License

MIT
