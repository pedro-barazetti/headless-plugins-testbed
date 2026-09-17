# World test scraper — Zyte CDP

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

- `ZYTE_CDP_ENDPOINT`: overrides the default `wss://pop-us.browser.zyte.com/wss?ttl=600` endpoint
- `SCREENSHOTS`: enables screenshots on errors; images will be saved to `./screenshots`

## Usage

Run the scraper directly

```sh
npm start
```

The default CDP session TTL is 600 seconds. The browser is closed after one scrape, which ends the Zyte session early.
