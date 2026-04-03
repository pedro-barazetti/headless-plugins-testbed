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
- `npm run selenium-proxy` → Selenium smoke test via proxy
- `npm run selenium-proxy-csv` → Selenium smoke test using URL list input
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

### Proxy smoke tests (via local headless proxy)

These scripts do **not** use the Zyte Smart Proxy plugins. They connect to your locally running headless proxy as an HTTP proxy.

- `npm run playwright-proxy`
  - Runs [headless-proxy/playwright_proxy.ts](headless-proxy/playwright_proxy.ts).
  - Launches Chromium via Playwright and navigates through the local proxy.
- `npm run selenium-proxy`
  - Runs [headless-proxy/selenium_proxy.ts](headless-proxy/selenium_proxy.ts).
  - Launches Chrome via Selenium WebDriver with `--proxy-server=...`.
- `npm run selenium-proxy-csv` (alias for `npm run selenium-proxy-csv-input`)
  - Runs [headless-proxy/selenium_proxy_csv_input.ts](headless-proxy/selenium_proxy_csv_input.ts).
  - Reads URL list from `test-urls.csv` and visits each URL through the local proxy.

Env vars used (optional overrides):

- These scripts currently use hardcoded defaults in code (`http://localhost:3128`, target URLs, wait timings).

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
