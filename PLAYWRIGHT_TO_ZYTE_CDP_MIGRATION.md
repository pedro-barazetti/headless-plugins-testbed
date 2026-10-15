# Migrate Playwright from proxy server 3128 to Zyte CDP

This migration **keeps Playwright**. It changes the browser connection from a locally launched Chromium routed through the headless proxy to a Zyte-hosted Chromium browser controlled through Chrome DevTools Protocol (CDP). The existing page navigation, locators, clicks, evaluation, and screenshot logic can mostly stay.

The recommendation is based on this testbed's [70-row evaluation](70_ROW_TEST_SUMMARY.md): both Zyte browser-proxy routes failed 5/5 times for the same 23 rows, while Playwright over Zyte CDP returned HTTP 200 and relevant content on all 23 in one pass. Zyte also says [proxy mode is not optimized for browser automation](https://docs.zyte.com/zyte-api/usage/proxy-mode.html). **The other 47 rows have not been tested through CDP.**

## 1. Replace the browser connection

The proxy setup launches a local browser:

```ts
const browser = await chromium.launch({
  headless: true,
  proxy: { server: 'http://127.0.0.1:3128' },
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
```

The CDP setup connects to a remote browser. The API key is sent in the CDP **connection** authorization header, not as a page request header:

```ts
import { chromium } from 'playwright';

const apiKey = process.env.API_KEY;
if (!apiKey) throw new Error('API_KEY is required');

const endpoint = process.env.ZYTE_CDP_ENDPOINT ?? 'https://browser.zyte.com/?ttl=180';
const browser = await chromium.connectOverCDP(endpoint, {
  headers: {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
  },
  timeout: 60_000,
});
const page = await browser.newPage();
```

The `https://browser.zyte.com/` endpoint and Basic authorization form are in [Zyte's current CDP guide](https://docs.zyte.com/zyte-api/usage/cdp.html#connecting). The **recorded 23-row success test** used `wss://pop-us.browser.zyte.com/wss?ttl=180`, which remains the default in this repo's [CDP helper](cdp-websocket/zyteCdp.ts). The HTTPS endpoint above follows current documentation but was not the endpoint used in that recorded test. Set `ZYTE_CDP_ENDPOINT` if you need to choose explicitly.

## 2. Keep the page workflow, change navigation readiness and checks

The [existing helper](cdp-websocket/zyteCdp.ts) uses `page.goto(url, { waitUntil: 'commit' })`, then attempts `domcontentloaded`. This handled cases where the remote browser replaced its initial loader and a direct `domcontentloaded` wait surfaced `net::ERR_ABORTED` despite rendered content in the earlier test.

```ts
import {
  closeZyteCdp,
  connectToZyteCdp,
  navigateWithCdp,
} from './cdp-websocket/zyteCdp';

const session = await connectToZyteCdp();
try {
  const response = await navigateWithCdp(session.page, targetUrl, 90_000);
  const status = response?.status();
  const title = await session.page.title();
  const text = (await session.page.locator('body').innerText()).trim();

  // Add a source-specific locator check before accepting a page in production.
  if (status !== 200 || !title || text.length < 40) {
    throw new Error(`Unusable page: HTTP ${status ?? 'no response'}; title=${title}`);
  }

  // Existing locators, clicks, scrolling, extraction, and screenshots go here.
} finally {
  await closeZyteCdp(session);
}
```

For a specific site, wait for an expected element or data field instead of relying only on body length. Error and challenge pages can contain substantial text. Save the HTTP status, final URL, title, relevant selector result, elapsed time, and a screenshot for a failure. A `page.goto()` response is the main-resource response; Playwright's [navigation documentation](https://playwright.dev/docs/api/class-page#page-goto) describes the `commit` and `domcontentloaded` stages.

## 3. Move proxy settings to CDP session settings

Remove the local `proxy.server` option and proxy-specific page headers such as `X-Crawlera-Region`, `Zyte-IPType`, and `Zyte-Browser-Html` from the migrated path. They configure proxy-mode requests; the CDP connection uses URL query parameters for its proxy allocation:

| Need | CDP setting | Initial choice |
| --- | --- | --- |
| Session lifetime | `ttl=180` | Keep the tested 180-second ceiling until runtime is measured |
| Country of outgoing IP | `proxy_region=US` or another two-letter country | Omit initially so Zyte chooses for the first target |
| IP type | `proxy_type=residential` or `datacenter` | Omit initially so Zyte chooses for the first target |

Example: `https://browser.zyte.com/?ttl=180&proxy_region=AU&proxy_type=residential`. These controls and defaults are documented by [Zyte](https://docs.zyte.com/zyte-api/usage/cdp.html#query-parameters). Changing the browser context's JavaScript geolocation does **not** select the outgoing proxy region.

One CDP connection has one IP address and cookie jar for its lifetime. Reuse that connection for a coherent multi-page workflow; start a new connection when jobs need separate identities or different regions. Zyte's [session explanation](https://docs.zyte.com/zyte-api/usage/cdp.html#sessions) also notes that a new CDP connection cannot reuse the IP and cookies of an earlier connection.

## 4. End remote sessions explicitly

Call CDP `Browser.close` before disconnecting:

```ts
try {
  // Work with page.
} finally {
  try {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Browser.close');
  } catch {
    // If explicit closure fails, Zyte will end the session at its TTL.
  } finally {
    await browser.close().catch(() => undefined);
  }
}
```

The repo's `closeZyteCdp()` helper now does this. [Zyte documents](https://docs.zyte.com/zyte-api/usage/cdp.html#session-duration) that Playwright's `browser.close()` alone disconnects without immediately ending the remote session; the session otherwise remains allocated until its TTL. Zyte bills CDP sessions based on the higher of navigation count or duration in 15-second units, so avoid leaving sessions idle. Choose TTL for the longest expected workflow, then close promptly.

## 5. Migrate in controlled passes

1. Confirm the account can open CDP sessions, set `API_KEY` in the environment, and run `npm run cdp:smoke`. The existing helper accepts `ZYTE_CDP_ENDPOINT`; do not print the key or the authorization header.
2. Use [the existing 23-row runner](output/cdp-retest-23-2026-09-28/run.ts) as the baseline implementation. It opens a new CDP connection per row with two concurrent workers. Its recorded output is in [the CDP results](output/cdp-retest-23-2026-09-28/comparison.csv). Copy the runner to a new run directory before rerunning it, because its result path is fixed and a rerun would overwrite the historical raw results.
3. Adapt that copy to the 70-row CSV, remove its `Expected 23 rows` guard, and retain row IDs and per-row outcomes. Start with two concurrent CDP connections; increase only after observing account limits, latency, and page correctness.
4. Compare the 70 CDP results with [the compact baseline](output/70-row-consolidated-2026-09-29/compact_results.csv). For acceptance, check expected content per source, not only HTTP 200. Repeat the hard cases to measure stability.
5. Only then switch the production workflow to CDP, keeping the old route available for rollback until the required sources and costs are verified.

A connection failure and a target-page failure are different. Zyte's [CDP error reference](https://docs.zyte.com/zyte-api/usage/cdp.html#errors) says a connection-level HTTP 401 indicates authentication trouble, 403 indicates account eligibility trouble, and 429 indicates a browser concurrency limit. A page that connects successfully and then returns HTTP 403 is a target response and needs a separate investigation.

## Trade-offs

- The 23-row CDP run is strong evidence for those rows, but one pass cannot establish repeatability or full 70-row coverage.
- [Playwright documents](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) that CDP connections have lower fidelity than its own browser protocol. Verify advanced Playwright features used by the production crawler.
- CDP session lifetime and concurrency affect cost. The tested runner opened one session per row with concurrency two; grouping pages into a session changes identity sharing and billing.
