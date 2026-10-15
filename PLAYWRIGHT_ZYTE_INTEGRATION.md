# Integrating Zyte API with Playwright

> **70-row evaluation update (September 2026):** The local headless-proxy route described below had persistent failures on 23 source rows in the recorded comparison. Playwright over Zyte CDP succeeded on those 23 in one pass. See the [test summary](70_ROW_TEST_SUMMARY.md) and [CDP migration guide](PLAYWRIGHT_TO_ZYTE_CDP_MIGRATION.md) when choosing an integration for these sources. The proxy setup below remains a description of that route, not the recommended migration path for this tested workload.

## Local headless-proxy architecture

Instead of connecting Playwright directly to `api.zyte.com:8011`, run the
[Zyte SmartProxy Headless Proxy](https://github.com/zytedata/zyte-smartproxy-headless-proxy)
between Playwright and Zyte API:

```text
Playwright -> Headless Proxy (localhost:3128) -> Zyte API -> target website
```

The Headless Proxy is designed for browser traffic. It:

- keeps the requests in a scraping cycle on the same Zyte session and IP;
- recovers the session when it becomes invalid;
- blocks ads and trackers before they reach Zyte;
- optionally downloads static assets without sending them through Zyte;
- provides local throttling and usage statistics.

The project still uses the former `Crawlera` name in some settings. Zyte API
proxy mode supports the required `X-Crawlera-*` headers for backward
compatibility, including the session header.

## Session model

Keep automatic session management enabled:

```toml
no_auto_sessions = false
```

One Headless Proxy instance manages one Zyte session. Use one instance per
browser or scraping cycle. If independent jobs need different sessions, run a
separate proxy container and local port for each job.

Do not route unrelated browsers through the same instance when they must have
separate identities. All browsers, contexts, and pages using the same proxy
instance share its session.

## 1. Create `config.toml`

Use the following as a starting point:

```toml
debug = false
dont_verify_crawlera_cert = false

# Enables automatic session management.
no_auto_sessions = false

# 0 means no local limit. Set this to the account concurrency limit if needed.
concurrent_connections = 0

bind_ip = "0.0.0.0"
bind_port = 3128
proxy_api_ip = "0.0.0.0"
proxy_api_port = 3130

# Zyte API proxy-mode endpoint.
crawlera_host = "api.zyte.com"
crawlera_port = 8011

# Supply the key through CRAWLERA_HEADLESS_APIKEY instead.
api_key = ""

# One conservative list. Avoid combining it with EasyList/EasyPrivacy.
adblock_lists = [
  "https://cdn.jsdelivr.net/gh/hagezi/dns-blocklists@latest/adblock/light.txt"
]

# These file types are downloaded directly instead of through Zyte.
direct_access_hostpath_regexps = [
  '.*?\.(?:txt|json|css|less|js|mjs|cjs|gif|ico|jpe?g|svg|png|webp|avif|mkv|mp4|mpe?g|webm|eot|otf|ttf|woff2?)$'
]

# Optional: URLs matching these expressions always use Zyte, even if they also
# match direct_access_hostpath_regexps.
# direct_access_except_hostpath_regexps = [
#   'static\.example\.com/.*'
# ]

[xheaders]
cookies = "disable"
profile = "desktop"
```

### Ad blocking

The EasyList plus EasyPrivacy combination blocked too much traffic in this
setup. Use only [HaGeZi Multi Light](https://github.com/hagezi/dns-blocklists/blob/main/adblock/light.txt)
as a conservative starting point. Its maintainer describes Light as the
smallest, most compatibility-focused tier. The local `config.toml` previously
used HaGeZi Pro; Light is narrower. Do not stack Light with Pro or other broad
lists.

Matching requests are stopped before they reach Zyte, reducing proxied
requests. Light can still block resources a particular site needs, so test the
target's behavior. If it blocks too much, set `adblock_lists = []` and use a
small, source-specific local filter list instead. The proxy accepts a local
file path in `adblock_lists`.

### Direct access

`direct_access_hostpath_regexps` does not block matching resources. It fetches
them directly, bypassing Zyte. CSS, fonts, images, media, JSON, and JavaScript
can therefore be loaded without consuming Zyte requests.

This setting must be tested for each source. Direct access can cause problems
when an asset:

- requires the same session or IP as the main page;
- is authenticated or contains a signed URL;
- is geolocation-dependent;
- blocks the scraper machine's public IP.

If necessary, use `direct_access_except_hostpath_regexps` to force specific
hosts or paths through Zyte. For sensitive websites, begin with only images and
fonts:

```toml
direct_access_hostpath_regexps = [
  '.*?\.(?:gif|ico|jpe?g|svg|png|webp|avif|eot|otf|ttf|woff2?)$'
]
```

## 2. Run the prebuilt Docker image

Pull the image:

```bash
docker pull zytedata/zyte-smartproxy-headless-proxy
```

Set the Zyte API key and start the container from the directory containing
`config.toml`:

```bash
export ZYTE_API_KEY='replace-with-your-key'

docker run --rm \
  --name zyte-headless-proxy \
  -e CRAWLERA_HEADLESS_APIKEY="$ZYTE_API_KEY" \
  -v "$PWD/config.toml:/config.toml:ro" \
  -p 127.0.0.1:3128:3128 \
  -p 127.0.0.1:3130:3130 \
  zytedata/zyte-smartproxy-headless-proxy
```

Keep the API key outside `config.toml`. Do not expose ports `3128` or `3130`
publicly. Port `3128` is the browser proxy; port `3130` is the statistics API.

## 3. Update Playwright

Remove the direct Zyte proxy credentials from the Playwright launch options.
Playwright should connect to the local Headless Proxy without a username or
password:

```go
browser, err := pw.Chromium.Launch(playwright.BrowserTypeLaunchOptions{
    Headless: playwright.Bool(true),
    Timeout:  playwright.Float(timeoutMs),
    Args: []string{
        "--no-sandbox",
        "--disable-setuid-sandbox",
    },
    Proxy: &playwright.Proxy{
        Server: "http://127.0.0.1:3128",
    },
})
if err != nil {
    return err
}
defer browser.Close()

ctx, err := browser.NewContext(playwright.BrowserNewContextOptions{
    IgnoreHttpsErrors: playwright.Bool(true),
    UserAgent:         &userAgent,
})
if err != nil {
    return err
}
defer ctx.Close()

page, err := ctx.NewPage()
if err != nil {
    return err
}

err = page.SetExtraHTTPHeaders(map[string]string{
    "Zyte-Geolocation":  region,
    "Zyte-Browser-Html": "false",
})
if err != nil {
    return err
}

_, err = page.Goto(targetURL, playwright.PageGotoOptions{
    WaitUntil: playwright.WaitUntilStateLoad,
    Timeout:   playwright.Float(timeoutMs),
})
if err != nil {
    return err
}
```

`Zyte-Browser-Html: false` is intentional: local Playwright renders the page,
while Zyte transports its network requests. The Zyte API key is used by the
Headless Proxy and is no longer passed to Playwright.

`IgnoreHttpsErrors` is required unless the Headless Proxy CA certificate is
installed in the browser's trust store.

## 4. Verify the setup

Open the statistics endpoint after loading a page:

```bash
curl --fail http://127.0.0.1:3130/stats
```

Useful fields include:

- `sessions_created`: confirms that session management is active;
- `crawlera_requests`: requests sent upstream to Zyte;
- `adblocked_requests`: requests blocked locally;
- `crawlera_errors` and `all_errors`: upstream and overall errors.

To measure the optimizations safely:

1. Test the website with ad blocking and direct access disabled.
2. Enable HaGeZi Multi Light and confirm that the website still works.
3. Enable direct access and verify scripts, styling, navigation, and extracted
   data.
4. Add source-specific exceptions when a resource must use the Zyte session.

The first request to a domain can take longer while Zyte prepares the session,
so keep a generous Playwright navigation timeout.

## References

- [Zyte SmartProxy Headless Proxy](https://github.com/zytedata/zyte-smartproxy-headless-proxy)
- [Zyte API proxy mode](https://docs.zyte.com/zyte-api/usage/proxy-mode.html)
- [Zyte API backward-compatible headers](https://docs.zyte.com/zyte-api/migration/zyte/smartproxy.html#parameter-mapping)
- [HaGeZi list tiers and compatibility guidance](https://github.com/hagezi/dns-blocklists/blob/main/FAQ.md#2-which-list-version-should-i-use)
