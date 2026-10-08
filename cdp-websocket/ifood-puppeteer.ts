import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer, { Browser, Page } from 'puppeteer';
import goianiaRequest from './requests/actions-goiania-2.json';
import salvadorRequest from './requests/actions-salvador-2.json';

type City = 'goiania' | 'salvador';
type Selector = { type: 'css' | 'xpath'; value: string; state?: 'attached' | 'visible' | 'hidden' };
type Action = {
  action: 'waitForSelector' | 'click' | 'type' | 'waitForTimeout';
  selector?: Selector;
  timeout?: number;
  text?: string;
  onError?: 'return' | 'continue';
};
type ActionResult = {
  index: number;
  action: string;
  selector?: string;
  status: 'success' | 'error' | 'skipped';
  onError: 'return' | 'continue';
  durationMs: number;
  timeoutMs?: number;
  error?: string;
};
type Evidence = {
  title: string;
  bodyExcerpt: string;
  addressLabels: string[];
  selectedSuggestion: string | null;
  merchantNames: string[];
  merchantUrls: string[];
  merchantCount: number;
  merchantsVisible: boolean;
  challengeDetected: boolean;
  blockDetected: boolean;
  verificationSuccessful: boolean;
};
type Report = {
  library: 'puppeteer';
  city: City;
  expectedAddress: string;
  startedAt: string;
  durationMs: number;
  endpoint: string;
  proxyRegion: 'BR';
  proxyType: 'residential';
  verificationWaitSeconds: number;
  sessionTtlSeconds: number;
  initialHttpStatus: number | null;
  navigationResponses: Array<{ elapsedMs: number; status: number; url: string }>;
  navigationWarning?: string;
  finalUrl: string | null;
  success: boolean;
  failureReason: string | null;
  actions: ActionResult[];
  evidence: Evidence | null;
  validation: Record<string, boolean>;
  artifacts: { html?: string; screenshot?: string };
  artifactErrors: string[];
};

const requests = { goiania: goianiaRequest, salvador: salvadorRequest };
const artifactRoot = join(process.cwd(), 'artifacts', 'cdp-websocket', 'ifood-puppeteer');
const verificationWaitSeconds = seconds('IFOOD_VERIFICATION_WAIT_SECONDS', 180, 1, 1800);
const sessionTtlSeconds = seconds('IFOOD_SESSION_TTL_SECONDS', 600, 15, 3600);
const actionTimeout = 10_000;
if (sessionTtlSeconds < verificationWaitSeconds + 120) {
  throw new Error('IFOOD_SESSION_TTL_SECONDS must exceed the verification wait by at least 120 seconds.');
}

function seconds(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(name + ' must be an integer between ' + min + ' and ' + max + '.');
  }
  return value;
}

function message(error: unknown): string {
  let text = (error instanceof Error ? error.message : String(error)).replace(/\u001b\[[0-9;]*m/g, '');
  const key = process.env.API_KEY;
  if (key) {
    text = text.split(key).join('<API_KEY>').split(Buffer.from(key + ':').toString('base64')).join('<AUTH>');
  }
  return text;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function query(selector?: Selector): string {
  if (!selector) throw new Error('This action requires a selector.');
  // Puppeteer 24 supports explicit XPath handlers, including parenthesized and relative XPath.
  return selector.type === 'xpath' ? 'xpath/' + selector.value : selector.value;
}

async function bounded<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + ' ms.')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function connect(endpoint: URL): Promise<Browser> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error('Missing API_KEY. Add it to .env.');
  const headers = { Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64') };
  let websocket = endpoint.toString();
  if (endpoint.protocol === 'https:' || endpoint.protocol === 'http:') {
    // Puppeteer 24's browserURL discovery omits headers and query parameters.
    // Resolve it explicitly so authentication and BR/residential/ttl reach Zyte.
    const discovery = new URL(endpoint);
    discovery.pathname = '/json/version';
    const response = await fetch(discovery, { headers, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error('CDP discovery returned HTTP ' + response.status + '.');
    const metadata = await response.json() as { webSocketDebuggerUrl?: string };
    if (!metadata.webSocketDebuggerUrl) throw new Error('CDP discovery did not return a WebSocket URL.');
    websocket = metadata.webSocketDebuggerUrl;
  } else if (endpoint.protocol !== 'wss:' && endpoint.protocol !== 'ws:') {
    throw new Error('The CDP endpoint must use HTTP(S) or WS(S).');
  }
  return puppeteer.connect({
    browserWSEndpoint: websocket,
    headers,
    defaultViewport: { width: 1440, height: 900 },
    protocolTimeout: (verificationWaitSeconds + 30) * 1_000,
  });
}

export async function executePuppeteerActions(
  page: Page,
  actions: Action[],
  city: City,
): Promise<{ results: ActionResult[]; selectedSuggestion: string | null }> {
  const results: ActionResult[] = [];
  let stopped = false;
  let selectedSuggestion: string | null = null;
  for (const [offset, action] of actions.entries()) {
    const started = Date.now();
    const result: ActionResult = {
      index: offset + 1, action: action.action, selector: action.selector?.value,
      status: stopped ? 'skipped' : 'success', onError: action.onError ?? 'return', durationMs: 0,
    };
    if (!stopped) {
      try {
        switch (action.action) {
          case 'waitForSelector': {
            result.timeoutMs = (offset === 0 ? verificationWaitSeconds : action.timeout ?? 10) * 1_000;
            const state = action.selector?.state ?? 'visible';
            const element = await page.waitForSelector(query(action.selector), {
              visible: state === 'visible',
              hidden: state === 'hidden',
              timeout: result.timeoutMs,
            });
            await element?.dispose();
            break;
          }
          case 'click':
            if (action.selector?.value.includes('btn-address--full-size')) {
              selectedSuggestion = await page.$eval(query(action.selector), (node) => node.textContent?.trim() ?? '');
            }
            await page.locator(query(action.selector)).setTimeout(actionTimeout).click();
            break;
          case 'type':
            await page.locator(query(action.selector)).setTimeout(actionTimeout).fill(action.text ?? '');
            break;
          case 'waitForTimeout':
            await delay((action.timeout ?? 0) * 1_000);
            break;
          default:
            throw new Error('Unsupported action: ' + action.action);
        }
      } catch (error) {
        result.status = 'error';
        result.error = message(error);
        stopped = result.onError === 'return';
      }
      result.durationMs = Date.now() - started;
      console.log('[' + city + '] Action ' + result.index + '/' + actions.length + ' ' + action.action + ': ' + result.status);
    }
    results.push(result);
  }
  return { results, selectedSuggestion };
}

async function collectEvidence(page: Page, selectedSuggestion: string | null): Promise<Evidence> {
  // Read one DOM snapshot; retry if Cloudflare replaces the document during collection.
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate((suggestion) => {
        const body = document.body?.innerText ?? '';
        const merchants = Array.from(document.querySelectorAll('span[class*="merchant-v2__name"]'));
        const visible = (node: Element) => {
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
        };
        const merchantNames = merchants.map((node) => node.textContent?.trim() ?? '').filter(Boolean);
        const addressLabels = Array.from(document.querySelectorAll(
          '.address-search-input--role-button, [class*="address-button"], [class*="delivery-address"], [class*="address-bar"]',
        )).map((node) => node.textContent?.trim() ?? '').filter(Boolean);
        return {
          title: document.title, bodyExcerpt: body.slice(0, 5_000), addressLabels: [...new Set(addressLabels)],
          selectedSuggestion: suggestion, merchantNames, merchantCount: merchantNames.length,
          merchantUrls: merchants.map((node) => node.closest('a')?.getAttribute('href') ?? '').filter(Boolean),
          merchantsVisible: merchants.some(visible),
          challengeDetected: /just a moment|security verification|verify.*not a bot|checking your browser|verifying you are human/i.test(document.title + '\n' + body),
          blockDetected: /attention required|sorry, you have been blocked|access denied/i.test(document.title + '\n' + body),
          verificationSuccessful: /verification successful/i.test(body),
        };
      }, selectedSuggestion);
    } catch (error) {
      if (attempt >= 2 || !/context.*destroyed|cannot find context|detached frame/i.test(message(error))) throw error;
      await delay(300);
    }
  }
}

export async function runPuppeteerCity(city: City): Promise<Report> {
  const request = requests[city];
  const expectedAddress = request.actions.find((action) => action.action === 'type')?.text ?? '';
  const endpoint = new URL(process.env.ZYTE_PUPPETEER_CDP_ENDPOINT || process.env.ZYTE_CDP_ENDPOINT || 'wss://pop-us.browser.zyte.com/wss');
  endpoint.searchParams.set('proxy_region', 'BR');
  endpoint.searchParams.set('proxy_type', 'residential');
  endpoint.searchParams.set('ttl', String(sessionTtlSeconds));
  const safeEndpoint = new URL(endpoint);
  safeEndpoint.username = '';
  safeEndpoint.password = '';
  const started = Date.now();
  const runDir = join(artifactRoot, new Date(started).toISOString().replace(/[:.]/g, '-') + '-' + city);
  mkdirSync(runDir, { recursive: true });
  const report: Report = {
    library: 'puppeteer', city, expectedAddress, startedAt: new Date(started).toISOString(), durationMs: 0,
    endpoint: safeEndpoint.toString(), proxyRegion: 'BR', proxyType: 'residential',
    verificationWaitSeconds, sessionTtlSeconds, initialHttpStatus: null, navigationResponses: [],
    finalUrl: null, success: false, failureReason: null, actions: [], evidence: null,
    validation: {}, artifacts: {}, artifactErrors: [],
  };
  let browser: Browser | null = null;
  let page: Page | null = null;
  let selectedSuggestion: string | null = null;
  try {
    console.log('[' + city + '] Connecting Puppeteer: ' + safeEndpoint);
    browser = await connect(endpoint);
    page = await browser.newPage();
    page.setDefaultTimeout(actionTimeout);
    page.on('response', (response) => {
      if (response.request().isNavigationRequest() && response.frame() === page?.mainFrame()) {
        report.navigationResponses.push({ elapsedMs: Date.now() - started, status: response.status(), url: response.url() });
      }
    });
    console.log('[' + city + '] Testing ' + expectedAddress + '; initial wait ' + verificationWaitSeconds + ' seconds.');
    try {
      report.initialHttpStatus = (await page.goto(request.url, { waitUntil: 'domcontentloaded', timeout: 60_000 }))?.status() ?? null;
    } catch (error) {
      if (!/ERR_ABORTED|Navigation timeout/i.test(message(error))) throw error;
      report.navigationWarning = message(error);
      report.initialHttpStatus = report.navigationResponses[0]?.status ?? null;
    }
    const execution = await executePuppeteerActions(page, request.actions as Action[], city);
    report.actions = execution.results;
    selectedSuggestion = execution.selectedSuggestion;
    const evidence = await collectEvidence(page, selectedSuggestion);
    report.evidence = evidence;
    const addressTokens = expectedAddress.split(/,\s*/);
    const street = normalize(addressTokens[0].replace(/^Av\.\s*/i, ''));
    const number = addressTokens[1]?.match(/^\d+/)?.[0] ?? '';
    report.validation = {
      requiredActionsSucceeded: execution.results.every((action) => action.onError === 'continue' || action.status === 'success'),
      addressMatches: normalize(evidence.selectedSuggestion ?? '').includes(city)
        && evidence.addressLabels.some((label) => normalize(label).includes(street) && new RegExp('\\b' + number + '\\b').test(label)),
      merchantsVisible: evidence.merchantsVisible,
      merchantCityMatches: evidence.merchantUrls.some((url) => normalize(url).includes(city)),
      accessClear: !evidence.challengeDetected && !evidence.blockDetected,
    };
    report.success = Object.values(report.validation).every(Boolean);
    const failed = execution.results.find((action) => action.status === 'error' && action.onError === 'return');
    report.failureReason = report.success ? null
      : evidence.blockDetected ? 'iFood returned a Cloudflare access block.'
      : evidence.verificationSuccessful ? 'Cloudflare reported verification successful, but the iFood address control did not load.'
      : evidence.challengeDetected ? 'iFood remained on the Cloudflare verification page.'
      : failed ? 'Required action ' + failed.index + ' (' + failed.action + ') failed: ' + failed.error
      : 'Result validation failed: ' + Object.entries(report.validation).filter(([, ok]) => !ok).map(([name]) => name).join(', ');
  } catch (error) {
    report.failureReason = message(error);
  } finally {
    if (page) {
      report.finalUrl = page.url();
      if (request.browserHtml) {
        try {
          const htmlPath = join(runDir, 'browser.html');
          writeFileSync(htmlPath, await bounded(page.content(), 15_000, 'HTML capture'), 'utf8');
          report.artifacts.html = htmlPath;
        } catch (error) { report.artifactErrors.push('HTML: ' + message(error)); }
      }
      try {
        const screenshotPath = join(runDir, 'screenshot.png');
        await bounded(page.screenshot({ path: screenshotPath, fullPage: true }), 15_000, 'Screenshot');
        report.artifacts.screenshot = screenshotPath;
      } catch (error) { report.artifactErrors.push('Screenshot: ' + message(error)); }
      // Read again after capture to record late verification transitions.
      try {
        report.evidence = await bounded(collectEvidence(page, selectedSuggestion), 10_000, 'Evidence');
      } catch (error) { report.artifactErrors.push('Evidence: ' + message(error)); }
      if (!report.success && report.evidence?.verificationSuccessful) {
        report.failureReason = 'Cloudflare reported verification successful, but the iFood address control did not load.';
      } else if (!report.success && report.evidence?.blockDetected) {
        report.failureReason = 'iFood returned a Cloudflare access block.';
      } else if (!report.success && report.evidence?.challengeDetected) {
        report.failureReason = 'iFood remained on the Cloudflare verification page.';
      }
    }
    if (browser) {
      try { await bounded(browser.close(), 10_000, 'Browser close'); }
      catch (error) {
        report.artifactErrors.push('Browser close: ' + message(error));
        await browser.disconnect().catch(() => undefined);
      }
    }
    report.durationMs = Date.now() - started;
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('[' + city + '] ' + (report.success ? 'PASS' : 'FAIL') + ': ' + (report.failureReason ?? report.evidence?.merchantCount + ' restaurants verified.'));
    console.log('[' + city + '] Report: ' + join(runDir, 'report.json'));
  }
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => !['all', 'goiania', 'salvador'].includes(arg))) {
    throw new Error('Usage: npm run cdp:ifood:puppeteer -- [all|goiania|salvador]');
  }
  const cities: City[] = args.length === 0 || args.includes('all')
    ? ['goiania', 'salvador'] : [...new Set(args)] as City[];
  const reports = await Promise.all(cities.map(runPuppeteerCity));
  mkdirSync(artifactRoot, { recursive: true });
  const summary = JSON.stringify(reports, null, 2) + '\n';
  writeFileSync(join(artifactRoot, 'summary.json'), summary);
  writeFileSync(join(artifactRoot, new Date().toISOString().replace(/[:.]/g, '-') + '-summary.json'), summary);
  if (reports.some((report) => !report.success)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => { console.error('iFood Puppeteer test failed:', message(error)); process.exitCode = 1; });
}
