# Zyte Headless Plugins Testbed

Unified playground to validate Zyte headless integrations and reference scripts. This repo evolves as additional plugins are integrated.

## Scope

This project is intended to test Zyte headless plugins and related tooling:

- https://github.com/zytedata/zyte-smartproxy-plugin
- https://github.com/zytedata/zyte-smartproxy-playwright
- https://github.com/zytedata/zyte-smartproxy-selenium
- https://github.com/zytedata/zyte-smartproxy-puppeteer
- https://github.com/zytedata/zyte-smartproxy-puppeteer-core
- https://github.com/zytedata/zyte-smartproxy-headless-proxy

Some integrations are still in progress. The repository aims to centralize experiments, scripts, and outputs as coverage grows.

## What’s inside

- Headless proxy local setup assets and instructions under [headless-proxy/setup](headless-proxy/setup)
- Playwright, Selenium, Puppeteer, and Playwright + 2Captcha reference scripts.
- Output samples and per-minute reports for benchmark runs.
- Shared utilities (user agent normalization, captcha helpers, etc.).

## Quick start

1. Create your environment file

   - Duplicate [.env.example](.env.example) to `.env` and set your keys.

2. Install dependencies

   - `npm install`

3. Set up the local headless proxy

   - Follow [headless-proxy/setup/instructions.txt](headless-proxy/setup/instructions.txt)
   - Replace config and cert in your local `zyte-smartproxy-headless-proxy` clone with files from [headless-proxy/setup](headless-proxy/setup)
   - Build and run the proxy locally

4. Run a sample script
   - Use the npm scripts listed below.

## Available npm scripts

- `npm run playwright-proxy` → Playwright smoke test via proxy
- `npm run playwright-proxy-csv` → Playwright CSV test via a local proxy
- `npm run playwright-zyte-api-direct-csv` → Playwright CSV test directly via Zyte API proxy mode
- `npm run cdp:smoke` → Playwright smoke test via Zyte CDP WebSocket
- `npm run cdp:freepeopledirectory` → FreePeopleDirectory form test via Zyte CDP WebSocket
- `npm run cdp:beenverified` → BeenVerified form/CAPTCHA-boundary test via Zyte CDP WebSocket
- `npm run cdp:thatsthem` → That’s Them screenshot test via Zyte CDP WebSocket
- `npm run cdp:ifood` → Run the converted Goiânia and Salvador iFood address/listing requests via Playwright + CDP
- `npm run cdp:ifood:puppeteer` → Run the same iFood requests using native Puppeteer + CDP
- `npm run selenium-proxy` → Selenium smoke test via proxy
- `npm run selenium-proxy-csv` → Selenium smoke test using URL list input
- `npm run splash-proxy-test` → Splash + Zyte API proxy compatibility/performance test
- `npm run clustrmaps` → Playwright + Zyte Smart Proxy flow (Cloudflare Turnstile)
- `npm run freepeopledirectory` → Playwright + Zyte Smart Proxy flow
- `npm run peoplefinders` → Playwright + Zyte Smart Proxy flow (Turnstile + reCAPTCHA Enterprise)
- `npm run publicdatausa` → Playwright + Zyte Smart Proxy flow (reCAPTCHA)
- `npm run usphonebook` → Playwright Extra + Zyte Smart Proxy plugin flow (Turnstile)
- `npm run beenverified` → Playwright + Zyte Smart Proxy flow (Turnstile + hCaptcha)
- `npm run voterrecords` → Playwright + Zyte Smart Proxy flow (Turnstile + hCaptcha)
- `npm run nuwber` → Playwright + Zyte Smart Proxy flow (Turnstile)
- `npm run platpat` → Puppeteer Extra + Zyte Smart Proxy plugin screenshot script
- `npm run informdata` → Puppeteer Extra + Zyte Smart Proxy plugin demo script

If you add new runners, update this list.

## Zyte CDP WebSocket tests

These runners use Playwright's native `chromium.connectOverCDP()` API and the
`API_KEY` from `.env`. The default endpoint is
`wss://pop-us.browser.zyte.com/wss?ttl=180`; the longer lifetime allows time
for external CAPTCHA solving. Override it with `ZYTE_CDP_ENDPOINT` if needed.

```bash
npm run cdp:smoke
npm run cdp:freepeopledirectory
npm run cdp:beenverified
npm run cdp:thatsthem
```

The site-specific runners navigate, validate selectors, fill the available
form, and save screenshots under `artifacts/cdp-websocket/`. They do not submit
anything by default:

- Set `FREEPEOPLEDIRECTORY_SUBMIT=true` to submit the configured profile URL.
- Set `BEENVERIFIED_SUBMIT_SEARCH=true` to submit the search form and continue
  to results. The CDP runner uses `TWO_CAPTCHA_KEY` to solve both the initial
  Cloudflare page and the Turnstile check before Continue.
- Set `BEENVERIFIED_STOP_AFTER_CONTINUE=true` to stop after Continue without
  interacting with a search result.

Use `FREEPEOPLEDIRECTORY_PROFILE_URL` and the `BEENVERIFIED_*` variables to
replace the sample data when you intentionally test a real flow.

### iFood action requests with Playwright + CDP

The original requests are saved under `cdp-websocket/requests/`. The
[runner](cdp-websocket/ifood.ts) converts their CSS/XPath selectors to Playwright
locators, converts timeout seconds to milliseconds, and preserves the action
order and `onError` behavior. The initial selector wait defaults to 180 seconds
to allow verification to complete; subsequent waits use the original request
timeouts. Required failures stop the sequence; optional
“Ver mais” failures are recorded and allow it to continue.

```bash
npm run cdp:ifood                   # both cities, each in a fresh session
npm run cdp:ifood -- goiania        # Goiânia only
npm run cdp:ifood -- salvador       # Salvador only
```

`API_KEY` is read from `.env`. This runner defaults to the documented
`https://browser.zyte.com/` endpoint and respects `ZYTE_CDP_ENDPOINT`.
It applies a 600-second session lifetime, including when the configured endpoint
has a different `ttl`. Both iFood runners read `IFOOD_VERIFICATION_WAIT_SECONDS`
and `IFOOD_SESSION_TTL_SECONDS` from `.env` to override these defaults; the
session must last at least 120 seconds longer than the verification wait.
It maps each request’s `geolocation: "BR"` to `proxy_region=BR` and explicitly
sets `proxy_type=residential`, including when the endpoint is overridden, as
described in the [Zyte CDP documentation](https://docs.zyte.com/zyte-api/usage/cdp.html#query-parameters).

Each city saves an action report, rendered HTML (the `browserHtml` equivalent
from `page.content()`), and a screenshot in a timestamped folder beneath
`artifacts/cdp-websocket/ifood/`. `summary.json` contains the latest batch.
Success requires the mandatory actions, a saved address matching the requested
street/number and selected city, visible restaurants with links for that city,
and a page clear of access blocks. The command exits with status 1 if either
city fails; Cloudflare challenge HTML is never counted as a successful result.
These runs select the supplied delivery addresses in isolated browser sessions.

### iFood with Puppeteer + CDP

The separate [Puppeteer runner](cdp-websocket/ifood-puppeteer.ts) uses the same
original requests and the installed `puppeteer` package. It always sends
`proxy_region=BR` and `proxy_type=residential`. Its defaults are a 180-second
initial selector wait and `ttl=600`, using the same timing configuration as the
Playwright runner; subsequent action timeouts and `onError`
behavior follow the requests. It runs each city in its own remote browser.

```bash
npm run cdp:ifood:puppeteer
npm run cdp:ifood:puppeteer -- goiania
npm run cdp:ifood:puppeteer -- salvador
```

It reads `API_KEY` from `.env` and defaults to the WebSocket endpoint from the
[Zyte Puppeteer example](https://docs.zyte.com/zyte-api/usage/cdp.html#connecting).
Override it with `ZYTE_PUPPETEER_CDP_ENDPOINT` or `ZYTE_CDP_ENDPOINT`. HTTP
endpoint discovery preserves authentication and query parameters. Set
`IFOOD_VERIFICATION_WAIT_SECONDS` and `IFOOD_SESSION_TTL_SECONDS` to tune timing;
the session lifetime must exceed the verification wait by at least 120 seconds.

Reports, rendered HTML, screenshots, and the latest `summary.json` are saved
under `artifacts/cdp-websocket/ifood-puppeteer/`. Reports also include the
navigation response history and whether Cloudflare displayed “Verification
successful” while the iFood address controls were still missing. The runner
exits with status 1 when either city does not complete and validate its results.

## Scripts (details)

### TypeScript checks

- `npm run typecheck`
  - Runs `tsc` in `--noEmit` mode to typecheck the whole workspace.
- `npm test`
  - Alias for `npm run typecheck`.

### Proxy smoke tests (via local headless proxy)

These scripts do **not** use the Zyte Smart Proxy plugins. They connect to your locally running headless proxy as an HTTP proxy.

- `npm run playwright-proxy`
  - Runs [headless-proxy/playwright_proxy.ts](headless-proxy/playwright_proxy.ts).
  - Launches Chromium via Playwright and navigates through the local proxy.
- `npm run playwright-proxy-csv`
  - Runs [headless-proxy/playwright_proxy_csv_input.ts](headless-proxy/playwright_proxy_csv_input.ts).
  - Reads one CSV file or all CSV files in a directory and uses the local proxy.
  - Defaults to 8 concurrent pages, retries proxy connection failures up to 3 times
    with exponential backoff, and saves results under a timestamped
    `output/playwright-proxy-csv/run_*` directory.
- `npm run selenium-proxy`
  - Runs [headless-proxy/selenium_proxy.ts](headless-proxy/selenium_proxy.ts).
  - Launches Chrome via Selenium WebDriver with `--proxy-server=...`.
- `npm run selenium-proxy-csv` (alias for `npm run selenium-proxy-csv-input`)
  - Runs [headless-proxy/selenium_proxy_csv_input.ts](headless-proxy/selenium_proxy_csv_input.ts).
  - Reads URL list from `test-urls.csv` and visits each URL through the local proxy.

Env vars used (optional overrides):

- `playwright-proxy-csv` accepts `URLS_CSV_PATH`, `PROXY_SERVER`,
  `MAX_CONCURRENCY`, `NAVIGATION_TIMEOUT_MS`, `NETWORK_IDLE_TIMEOUT_MS`
  (default 5000), `WAIT_FOR_NETWORK_IDLE`, `PROXY_CONNECTION_MAX_ATTEMPTS`
  (default 3), `PROXY_RETRY_BASE_DELAY_MS` (default 1000), `HEADLESS`,
  `OUTPUT_DIR`, and `RESULTS_PATH`. Results include retry counts, failed
  document and subresource request counts, up to five failed subresource
  examples, and a basic content check (at least 40 body text characters or an
  embedded visual element). This is a diagnostic, not proof of a complete
  render. Results are checkpointed every 100 URLs, and Ctrl+C saves partial
  results.
- For separate SPM proxy runs, set `PROXY_SERVER=http://localhost:3128` or
  `PROXY_SERVER=http://localhost:3228` and use a distinct `OUTPUT_DIR` for each.
- The single-URL smoke scripts retain hardcoded defaults for their target URLs
  and timings.

### Playwright directly via Zyte API proxy mode

`npm run playwright-zyte-api-direct-csv` runs
[headless-proxy/playwright_zyte_api_direct_csv.ts](headless-proxy/playwright_zyte_api_direct_csv.ts)
against `http://api.zyte.com:8011` with the Zyte API key as the proxy username.
It does not require the local headless proxy on port 3128.

By default, it reads the 4,620-row render input at
`output/proxy-comparison-render-2026-09-17/render_urls.csv`, uses concurrency
8, runs headless, and writes `results.json` under a timestamped
`output/zyte-api-direct/run_*` directory:

```bash
npm run playwright-zyte-api-direct-csv
```

Set `ZYTE_API_KEY` or `API_KEY` before running. Optional overrides are
`URLS_CSV_PATH`, `ZYTE_API_PROXY_SERVER`, `ZYTE_IP_TYPE`, `MAX_CONCURRENCY`,
`NAVIGATION_TIMEOUT_MS`, `NETWORK_IDLE_TIMEOUT_MS`, `WAIT_FOR_NETWORK_IDLE`,
`PROXY_CONNECTION_MAX_ATTEMPTS` (default 3), `PROXY_RETRY_BASE_DELAY_MS`
(default 1000), `HEADLESS`, `SAVE_SCREENSHOTS`, `OUTPUT_DIR`, and
`RESULTS_PATH`. Failed proxy connections are retried with exponential backoff.
Set `ZYTE_IP_TYPE=residential` to send `Zyte-IPType: residential` on browser
requests. Leave it unset to use Zyte API's default IP type.
Results include attempt counts, failed document and subresource request counts,
separate subresource proxy connection and abort counts, up to five failed
subresource examples, and a basic rendered content check
(at least 40 body text characters or an embedded visual element). The content
check is a diagnostic signal, not proof that the intended page rendered.
`navigationElapsedMs` measures time to DOM content loaded; `elapsedMs` includes
the network-idle wait, which is capped at 5 seconds by default. Progress is
saved every 100 completed URLs, and Ctrl+C saves the partial results.

### Splash + Zyte API proxy mode

The Splash integration test runs the same page directly and through Zyte API
proxy mode. It evaluates a JavaScript DOM assertion and confirms proxy use from
the `Zyte-Request-ID` response header captured in Splash's HAR, then reports
success rate, p50/p95 latency, and median proxy overhead.

```bash
npm run splash-up
npm run splash-proxy-test
npm run splash-down
```

Docker and `API_KEY` in `.env` are required. See
[splash/README.md](splash/README.md) for benchmark settings and interpretation.

### Playwright “captcha/opt-out” flows (plugin-based)

These scripts are in [playwright-2captcha](playwright-2captcha) and primarily use `zyte-smartproxy-playwright` (and in one case Playwright Extra + `zyte-smartproxy-plugin`). They automate opt-out and form flows and include experimental CAPTCHA helpers.

Common env vars:

- `SPM_API_KEY` (preferred) or `API_KEY`
  - Used as `spm_apikey` for the Zyte Smart Proxy integrations.
- `TWO_CAPTCHA_KEY` (only required for scripts that solve CAPTCHAs via 2Captcha)

Notes:

- Several scripts contain **hardcoded test PII** (name/email/city/etc.). Treat these as reference implementations; adjust data and selectors as needed.
- Many scripts write debugging screenshots to the repo root (e.g., `*-success.png`).

Per-script summary:

- `npm run clustrmaps`
  - Runs [playwright-2captcha/clustrmaps.ts](playwright-2captcha/clustrmaps.ts).
  - Uses Cloudflare Turnstile helpers; may require `TWO_CAPTCHA_KEY`.
- `npm run freepeopledirectory`
  - Runs [playwright-2captcha/freepeopledirectory.ts](playwright-2captcha/freepeopledirectory.ts).
  - Submits an opt-out URL flow (profile URL is hardcoded in the script).
- `npm run peoplefinders`
  - Runs [playwright-2captcha/peoplefinders.ts](playwright-2captcha/peoplefinders.ts).
  - Uses Turnstile helpers and attempts reCAPTCHA Enterprise solve.
- `npm run publicdatausa`
  - Runs [playwright-2captcha/publicdatausa.ts](playwright-2captcha/publicdatausa.ts).
  - Demonstrates a reCAPTCHA solve flow.
- `npm run usphonebook`
  - Runs [playwright-2captcha/usphonebook.ts](playwright-2captcha/usphonebook.ts).
  - Uses Playwright Extra + `zyte-smartproxy-plugin` + stealth.
- `npm run beenverified`
  - Runs [playwright-2captcha/beenverified.ts](playwright-2captcha/beenverified.ts).
  - Turnstile + hCaptcha helper example.
  - Set `BEENVERIFIED_STOP_AFTER_CONTINUE=true` to verify both initial and
    form-level Turnstile handling without selecting a result or submitting a removal.
- `npm run voterrecords`
  - Runs [playwright-2captcha/voterrecords.ts](playwright-2captcha/voterrecords.ts).
  - Similar structure to beenverified; includes Turnstile + hCaptcha steps.
- `npm run nuwber`
  - Runs [playwright-2captcha/nuwber.ts](playwright-2captcha/nuwber.ts).
  - Turnstile solving via 2Captcha; may require `TWO_CAPTCHA_KEY`.

### Puppeteer demos (plugin-based)

These scripts are in [puppeteer/](puppeteer/) and use Puppeteer Extra + stealth + `zyte-smartproxy-plugin`.

- `npm run platpat`
  - Runs [puppeteer/platpat.ts](puppeteer/platpat.ts).
  - Navigates to J-PlatPat and saves a screenshot (`platpat.png`).
- `npm run informdata`
  - Runs [puppeteer/informdata_courts.ts](puppeteer/informdata_courts.ts).
  - Demonstrates navigation/screenshot through the proxy plugin.

## Proxy configuration

The local headless proxy is configured in [headless-proxy/setup/config.toml](headless-proxy/setup/config.toml). Key options include:

- `api_key`
- `bind_ip`, `bind_port`
- `crawlera_host`, `crawlera_port`
- `concurrent_connections`, `no_auto_sessions`
- `[xheaders]` for profile/cookies behavior

See [headless-proxy/setup/instructions.txt](headless-proxy/setup/instructions.txt) for the full local build/run steps.

## Environment variables

The repo uses a single `.env` file (see [.env.example](.env.example)) mainly for script credentials:

- Script credentials (`SPM_API_KEY`, `API_KEY`, `TWO_CAPTCHA_KEY`)
- Optional `CRAWLERA_*` values kept for convenience when configuring your local headless proxy setup.

## Notes

- The headless proxy is MITM for HTTPS; trust the certificate if needed for your test environment.
- Some scripts are intentionally experimental and may require manual adjustments.

## Contributing

Add new test scripts under the appropriate folder ([headless-proxy](headless-proxy), [playwright-2captcha](playwright-2captcha), or [puppeteer](puppeteer)) and update this README.
