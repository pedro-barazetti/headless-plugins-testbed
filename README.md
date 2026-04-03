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

- Docker Compose setup for Zyte Smart Proxy Headless Proxy.
- Playwright, Selenium, Puppeteer, and Playwright-captcha reference scripts.
- Output samples and per-minute reports for benchmark runs.
- Shared utilities (user agent normalization, captcha helpers, etc.).

## Quick start

1. Create your environment file
   - Duplicate .env.example to .env and set your API key.

2. Install dependencies
    - `npm install`

3. Start the headless proxy (optional, only for the `*-proxy` smoke tests)
    - `docker compose up -d`

4. Run a sample script
    - Use the npm scripts listed below.

## Available npm scripts

- `npm run playwright-proxy` → Playwright smoke test via proxy
- `npm run selenium-proxy` → Selenium smoke test via proxy
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

## Scripts (details)

### TypeScript checks

- `npm run typecheck`
   - Runs `tsc` in `--noEmit` mode to typecheck the whole workspace.
- `npm test`
   - Alias for `npm run typecheck`.

### Proxy smoke tests (via headless proxy container)

These scripts do **not** use the Zyte Smart Proxy plugins. They connect to the local headless proxy (Docker Compose) as an HTTP proxy.

- `npm run playwright-proxy`
   - Runs [playwright/playwright_proxy.ts](playwright/playwright_proxy.ts).
   - Launches a Chromium browser via Playwright and navigates to `TARGET_URL` through `ZYTE_PROXY`.
- `npm run selenium-proxy`
   - Runs [selenium/selenium_proxy.ts](selenium/selenium_proxy.ts).
   - Launches Chrome via Selenium WebDriver with `--proxy-server=...` and navigates to `TARGET_URL`.

Env vars used (optional overrides):

- `ZYTE_PROXY` (default `http://localhost:3128`)
- `TARGET_URL` (defaults to a court site)
- `WAIT_MS` (defaults to 5000–15000 depending on the script)

### Playwright “captcha/opt-out” flows (plugin-based)

These scripts are in [playwright_captcha/](playwright_captcha/) and primarily use `zyte-smartproxy-playwright` (and in one case Playwright Extra + `zyte-smartproxy-plugin`). They automate opt-out / form flows and include experimental CAPTCHA helpers.

Common env vars:

- `SPM_API_KEY` (preferred) or `API_KEY`
   - Used as `spm_apikey` for the Zyte Smart Proxy integrations.
- `TWO_CAPTCHA_KEY` (only required for scripts that solve CAPTCHAs via 2Captcha)

Notes:

- Several scripts contain **hardcoded test PII** (name/email/city/etc.). Treat these as reference implementations; adjust data and selectors as needed.
- Many scripts write debugging screenshots to the repo root (e.g., `*-success.png`).

Per-script summary:

- `npm run clustrmaps`
   - Runs [playwright_captcha/clustrmaps.ts](playwright_captcha/clustrmaps.ts).
   - Uses Cloudflare Turnstile helpers; may require `TWO_CAPTCHA_KEY`.
- `npm run freepeopledirectory`
   - Runs [playwright_captcha/freepeopledirectory.ts](playwright_captcha/freepeopledirectory.ts).
   - Submits an opt-out URL flow (profile URL is hardcoded in the script).
- `npm run peoplefinders`
   - Runs [playwright_captcha/peoplefinders.ts](playwright_captcha/peoplefinders.ts).
   - Uses Turnstile helpers and attempts reCAPTCHA Enterprise solve.
- `npm run publicdatausa`
   - Runs [playwright_captcha/publicdatausa.ts](playwright_captcha/publicdatausa.ts).
   - Demonstrates a reCAPTCHA solve flow.
- `npm run usphonebook`
   - Runs [playwright_captcha/usphonebook.ts](playwright_captcha/usphonebook.ts).
   - Uses Playwright Extra + `zyte-smartproxy-plugin` + stealth.
- `npm run beenverified`
   - Runs [playwright_captcha/beenverified.ts](playwright_captcha/beenverified.ts).
   - Turnstile + hCaptcha helper example.
- `npm run voterrecords`
   - Runs [playwright_captcha/voterrecords.ts](playwright_captcha/voterrecords.ts).
   - Similar structure to beenverified; includes Turnstile + hCaptcha steps.
- `npm run nuwber`
   - Runs [playwright_captcha/nuwber.ts](playwright_captcha/nuwber.ts).
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

The headless proxy is configured via environment variables mapped to CLI flags:

- `CRAWLERA_HEADLESS_NOAUTOSESSIONS` → `-t, --no-auto-sessions`
- `CRAWLERA_HEADLESS_CONCURRENCY` → `-n, --concurrent-connections`
- `CRAWLERA_HEADLESS_APIKEY` → `-a, --api-key`
- `CRAWLERA_HEADLESS_CHOST` → `-u, --crawlera-host`
- `CRAWLERA_HEADLESS_CPORT` → `-o, --crawlera-port`
- `CRAWLERA_HEADLESS_DONTVERIFY` → `-v, --dont-verify-crawlera-cert`
- `CRAWLERA_HEADLESS_XHEADERS` → `-x, --xheader` (comma-separated pairs like `profile=desktop,cookies=disable`)

The container listens on `0.0.0.0:3128` and is published to the host at the port defined by `SPM_LOCAL_PORT`.

## Environment variables

The repo uses a single `.env` file (see [.env.example](.env.example)) for both:

- Script credentials (`SPM_API_KEY`, `API_KEY`, `TWO_CAPTCHA_KEY`)
- Docker Compose inputs for the headless proxy (`CRAWLERA_API_KEY`, etc.)

### Headless proxy (Docker Compose)

In [.env.example](.env.example), you set `CRAWLERA_*` variables (e.g. `CRAWLERA_API_KEY`).
In [docker-compose.yml](docker-compose.yml), those are mapped into the container as `CRAWLERA_HEADLESS_*` variables.

### Proxy smoke-test scripts

Used by `npm run playwright-proxy` and `npm run selenium-proxy`:

- `ZYTE_PROXY` (default `http://localhost:3128`)
- `TARGET_URL` (default is the Fairfield County site)
- `WAIT_MS` (default `5000`)

## Notes

- The headless proxy is MITM for HTTPS; trust the certificate if needed for your test environment.
- Some scripts are intentionally experimental and may require manual adjustments.

## Contributing

Add new test scripts under the appropriate folder (playwright/, selenium/, puppeteer/, playwright_captcha/) and update this README.
