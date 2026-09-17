import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, BrowserContext, Page, Response, chromium } from 'playwright';

const DEFAULT_WS_ENDPOINT = 'wss://pop-us.browser.zyte.com/wss?ttl=180';
const ARTIFACTS_DIR = join(process.cwd(), 'artifacts', 'cdp-websocket');

export interface ZyteCdpSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export interface ChallengeDetails {
  detected: boolean;
  indicators: string[];
}

export async function connectToZyteCdp(): Promise<ZyteCdpSession> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('Missing API_KEY. Add API_KEY=your_key to .env.');
  }

  const endpoint = process.env.ZYTE_CDP_ENDPOINT || DEFAULT_WS_ENDPOINT;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
  };

  console.log(`Connecting to Zyte CDP WebSocket: ${maskEndpoint(endpoint)}`);
  const browser = await chromium.connectOverCDP(endpoint, {
    headers,
    timeout: 60_000,
  });

  // browser.newPage() mirrors Zyte's reference snippet and creates an isolated
  // context owned by this test run.
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });

  return { browser, context: page.context(), page };
}

export function envFlag(name: string): boolean {
  return /^(1|true|yes)$/i.test(process.env[name] || '');
}

export async function navigateWithCdp(
  page: Page,
  url: string,
  timeout = 90_000,
): Promise<Response | null> {
  // The remote CDP browser can replace its initial loader after the response is
  // committed. Waiting for domcontentloaded directly in goto() may then surface
  // net::ERR_ABORTED even though the page rendered successfully.
  const response = await page.goto(url, {
    waitUntil: 'commit',
    timeout,
  });

  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {
    console.log('DOM lifecycle event was not observed; continuing from the committed response.');
  });
  return response;
}

export async function detectCaptchaOrChallenge(page: Page): Promise<ChallengeDetails> {
  const selectors: Array<[string, string]> = [
    ['Cloudflare challenge', '#challenge-running, .cf-challenge, #cf-challenge-running'],
    ['Cloudflare Turnstile', '.cf-turnstile, iframe[src*="challenges.cloudflare.com"]'],
    ['hCaptcha', '.h-captcha, iframe[src*="hcaptcha.com"], textarea[name="h-captcha-response"]'],
    ['reCAPTCHA', '.g-recaptcha, iframe[src*="recaptcha"], textarea[name="g-recaptcha-response"]'],
  ];

  const indicators: string[] = [];
  for (const [label, selector] of selectors) {
    if (await page.locator(selector).count()) indicators.push(label);
  }

  const bodyText = (await page.locator('body').textContent().catch(() => '')) || '';
  if (
    /verify (that )?you are human|verif(?:y|ies|ying) you are not a bot|checking your browser|not a robot|security (?:check|verification)/i.test(
      bodyText,
    )
  ) {
    indicators.push('challenge text');
  }

  return {
    detected: indicators.length > 0,
    indicators: [...new Set(indicators)],
  };
}

export async function saveScreenshot(page: Page, name: string): Promise<string> {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const path = join(ARTIFACTS_DIR, name);
  await page.screenshot({ path, fullPage: true });
  console.log(`Screenshot: ${path}`);
  return path;
}

export async function closeZyteCdp(session: ZyteCdpSession | null): Promise<void> {
  if (!session) return;
  await session.browser.close().catch(() => undefined);
}

function maskEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '<configured endpoint>';
  }
}
