# Taiwan test scraper — Zyte CDP

## Requirements

- node v18.20
- Zyte API key

## Setup instructions

```sh
# create env file from example
cp env.example .env

# if you're using nvm; otherwise make sure you're using v18.20
nvm use

# install node packages
npm i
```

### env

Use the env file to specify your api key. Optionally, you can also specify CDP endpoint.

The rest of the env file can be used to set the following options:

- `ZYTE_CDP_ENDPOINT`: overrides the default Zyte CDP endpoint
- `SCREENSHOTS`: enables screenshots on errors; images will be saved to `./screenshots`

The default endpoint uses a 600-second session TTL; add `&proxy_region=TW` to `ZYTE_CDP_ENDPOINT` when a Taiwan exit IP is required. The browser is closed after one scrape.

## Usage

Run the scraper directly

```sh
npm start
```

## Live CDP status

TIPONet currently returns `net::ERR_TUNNEL_CONNECTION_FAILED` through Zyte CDP. This was reproduced with automatic routing, `proxy_region=TW`, and `proxy_type=residential`. The original Zyte API proxy-mode script still completes.

## Errors

The errors to look out for are:

    - `Error loading patent search page.`
    - `Unknown page after doing patent search`

Errors that can likely be ignored:

    - `Patent number not found. Aborting.` <-- we're using an arbitrary set of search terms, so this might happen
    - `File list unavailable, aborting.`
