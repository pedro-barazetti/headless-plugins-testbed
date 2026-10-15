# 70-row Playwright and Zyte API test summary

**Scope.** The client-supplied `render-spm-ok-zyte-fail.csv` contains 70 rows, representing 69 unique URLs across 37 hostnames. This report consolidates the saved runs from 24–29 September 2026. A row is a source record; the same URL appears in two records.

## Main comparison: five passes over all 70 rows

On 25 September, each row was visited five times with headless Playwright through each route: Smart Proxy Manager (SPM) via isolated local port 3428, Zyte API via isolated local proxy port 3328, and direct Zyte API proxy mode at `api.zyte.com:8011`. The local proxy instances were restarted before each pass. These ports and results should not be confused with the later port 3128 configuration retests.

“Usable” required HTTP 200, a basic body-text or embedded-content check, and no browser navigation error. It is a diagnostic threshold, **not** proof that the intended content rendered correctly.

| Route | Usable visits / 350 | Failed visits / 350 | Rows that failed 5/5 | Rows with mixed results | Rows that passed 5/5 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Playwright + SPM proxy | 290 (82.9%) | 60 (17.1%) | 0 | 28 | 42 |
| Playwright + Zyte API local proxy | 212 (60.6%) | 138 (39.4%) | 24 | 10 | 36 |
| Playwright + direct Zyte API proxy mode | 198 (56.6%) | 152 (43.4%) | 27 | 11 | 32 |

Twenty-three rows (22 unique URLs, 18 hostnames) failed **every pass on both Zyte browser-proxy routes**. Those 23 rows had 115/115 HTTP 500 responses through the local Zyte API proxy and 110/115 HTTP 520 plus 5/115 HTTP 500 responses through direct Zyte API proxy mode. SPM returned HTTP 200 on 73/115 visits for that subset; every one of the 23 rows succeeded with SPM at least once, although only four succeeded on all five SPM passes. No individual row failed all five times on all three routes.

An earlier single-pass retest of the 70 rows, after three direct-route retries, classified 40 as usable on both Zyte routes, four on the local proxy only, three on direct proxy mode only, and 23 on neither. The five-pass data establishes which of those failures persisted.

## Follow-up tests on the 23 persistent Zyte failures

| Follow-up route | Test volume | Outcome |
| --- | ---: | --- |
| Direct Zyte API proxy mode with `Zyte-IPType: residential` | 23 rows × 1 | 0 usable; 22 HTTP 520 and one HTTP 500 |
| Non-rendered Axios GET through Zyte API proxy mode | 23 rows × 5 | 115/115 HTTP 200 with nonempty bodies |
| Playwright connected to Zyte's CDP browser | 23 rows × 1 | 23/23 HTTP 200 with relevant page titles and visible text |
| Latest Playwright + local Zyte API proxy, port 3128, default Chromium user agent | 23 rows × 1 | 22 HTTP 403 and one HTTP 500; 0 usable |

The Axios result shows that Zyte API could fetch these pages as non-rendered HTTP requests. The CDP result shows that the same 23 rows were accessible in a Zyte-hosted browser during one pass. Together, these results point to the **browser-through-proxy path** as the relevant failure mode in this test setup. They do not establish a CDP success rate for the other 47 rows or guarantee repeated CDP success on the 23.

The latest port 3128 retest followed proxy configuration changes and removal of a fixed Playwright user agent. Seventeen of the 22 HTTP 403 bodies in the preceding configuration pass showed “Access Denied”; two showed a browser check and three had no visible body text. The latest pass kept the same 22/1 status split. A four-URL sample without the forced US region header also kept its statuses. The single HTTP 500 on the latest pass was `softwaredevelopers.ato.gov.au/eInvoicing`, with a `session_manager` error.

## Decision for migration

For workflows that require Playwright interactions, validate **Playwright over Zyte CDP** as the replacement path. It succeeded on all 23 URLs in the focused one-pass retest, while both browser-proxy routes failed on every one of their five passes. Keep ordinary Zyte API HTTP requests in consideration where rendering and interaction are unnecessary; they succeeded on all 115 focused Axios requests. Run the remaining 47 source rows through CDP before claiming coverage for the full 70-row set.

Zyte's [proxy-mode documentation](https://docs.zyte.com/zyte-api/usage/proxy-mode.html) states that proxy mode is not optimized for browser automation; its [CDP documentation](https://docs.zyte.com/zyte-api/usage/cdp.html) describes a live browser connection for Playwright. The implementation steps are in [PLAYWRIGHT_TO_ZYTE_CDP_MIGRATION.md](PLAYWRIGHT_TO_ZYTE_CDP_MIGRATION.md).

## Data and limits

- [Compact 70-row results](output/70-row-consolidated-2026-09-29/compact_results.csv) includes each row's five-pass failure counts and, where tested, the focused Axios, CDP, and latest port 3128 results. Blank focused-test fields mean **not tested**.
- [Full five-pass per-URL data](output/five-pass-70-2026-09-25/url_consistency.csv) and [round-by-round summary](output/five-pass-70-2026-09-25/summary.md) contain statuses and consistency classifications.
- [CDP per-URL results](output/cdp-retest-23-2026-09-28/comparison.csv), [Axios results](output/axios-nonrendered-23-2026-09-25/url_comparison.csv), and [latest port 3128 comparison](output/port-3128-retest-23-2026-09-29-v3/comparison.csv) support the follow-up table.
- This is an observational comparison from the recorded configurations and dates. HTTP 200 plus body text is a basic screen; production acceptance should also check expected page elements or data and repeat the CDP run.
