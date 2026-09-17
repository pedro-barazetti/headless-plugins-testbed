# Splash + Zyte API proxy compatibility benchmark

This integration test checks that Splash 3.5 can still load a page and execute
a JavaScript DOM assertion through Zyte API proxy mode. It also compares
end-to-end render latency with direct Splash requests.

The proxy assertion is deliberately stronger than checking for rendered HTML:
the target document must render the configured DOM selector and Splash's HAR
must contain the `Zyte-Request-ID` response header. This prevents a proxy
configuration mistake from producing a false pass through a direct connection.

## Run

Docker is required. Set `API_KEY` in the repository's `.env` file, then run:

```bash
npm run splash-up
npm run splash-proxy-test
npm run splash-down
```

`splash-up` binds Splash only to `127.0.0.1`. It creates the authenticated
proxy profile in a private Docker volume, rather than storing the API key in a
tracked file. Browser caches are disabled so each measured sample produces a
real network request and a verifiable HAR entry. `splash-down` removes the
container and that volume.

By default, the benchmark performs one warm-up and five measured requests for
each variant. It alternates direct and proxied requests to reduce ordering bias,
prints success/latency statistics, and writes a detailed JSON report under
`output/`.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SPLASH_PORT` | `8050` | Host port used by the Dockerized Splash server |
| `SPLASH_URL` | `http://127.0.0.1:$SPLASH_PORT` | Use an already-running Splash server |
| `SPLASH_TARGET_URL` | `https://toscrape.com/` | Page rendered by both variants |
| `SPLASH_EXPECTED_SELECTOR` | `h1` | Selector evaluated in Splash's JavaScript engine |
| `SPLASH_EXPECTED_TEXT` | `Web Scraping Sandbox` | Text that must exist in rendered HTML; set empty to skip |
| `SPLASH_RUNS` | `5` | Measured requests per variant |
| `SPLASH_WARMUP_RUNS` | `1` | Unmeasured warm-up requests per variant |
| `SPLASH_WAIT_SECONDS` | `1` | Splash wait after page load |
| `SPLASH_TIMEOUT_SECONDS` | `90` | Overall Splash render timeout |
| `SPLASH_RESOURCE_TIMEOUT_SECONDS` | `60` | Per-resource timeout |
| `SPLASH_MIN_SUCCESS_RATE` | `1` | Required success fraction for both variants |
| `SPLASH_RESULT_FILE` | timestamped file in `output/` | JSON report path |

When changing the target, also change the expected selector and text. Keep the
same target for both variants so the reported median difference represents the
proxy path rather than different page behavior.

## Interpreting results

- `Compatibility: PASS` means both direct and proxied variants met the required
  success rate, Splash executed the JavaScript DOM assertion, and every successful
  proxied sample was verified from its Zyte response header.
- `p50Ms` is the median end-to-end render time and is the main comparison value.
- `p95Ms` is useful for spotting tail latency, but use more than five runs for a
  meaningful performance study.
- Median proxy overhead is `proxied p50 - direct p50`; it includes Zyte API
  routing and ban-avoidance work.

Zyte documents that proxy mode is supported but is not optimized for browser
automation. This test measures the combination as requested; it does not imply
that Splash is the recommended browser-automation client for Zyte API.
