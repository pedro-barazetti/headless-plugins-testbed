import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from 'playwright';
import { sessionTtlSeconds, verificationWaitSeconds } from './ifoodTiming';
import goianiaRequest from './requests/actions-goiania-2.json';
import salvadorRequest from './requests/actions-salvador-2.json';
import {
  ZyteCdpSession,
  closeZyteCdp,
  connectToZyteCdp,
  navigateWithCdp,
} from './zyteCdp';

type City = 'goiania' | 'salvador';
type ActionSelector = {
  type: 'css' | 'xpath';
  value: string;
  state?: 'attached' | 'visible' | 'hidden';
};
type Action = {
  action: 'waitForSelector' | 'click' | 'type' | 'waitForTimeout';
  selector?: ActionSelector;
  timeout?: number;
  text?: string;
  onError?: 'return' | 'continue';
};
type Request = {
  url: string;
  browserHtml: boolean;
  geolocation: string;
  actions: Action[];
};
type ActionResult = {
  index: number;
  action: Action['action'];
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
  merchantCount: number;
  merchantNames: string[];
  merchantUrls: string[];
  challengeDetected: boolean;
  blockDetected: boolean;
};
type Report = {
  city: City;
  expectedAddress: string;
  startedAt: string;
  durationMs: number;
  endpoint: string;
  proxyRegion: string;
  proxyType: 'residential';
  verificationWaitSeconds: number;
  sessionTtlSeconds: number;
  httpStatus: number | null;
  finalUrl: string | null;
  success: boolean;
  failureReason: string | null;
  actions: ActionResult[];
  evidence: Evidence | null;
  validation: {
    requiredActionsSucceeded: boolean;
    addressMatches: boolean;
    merchantsVisible: boolean;
    merchantCityMatches: boolean;
    accessClear: boolean;
  };
  artifacts: { html?: string; screenshot?: string };
  artifactErrors: string[];
};

const requests: Record<City, Request> = {
  goiania: goianiaRequest as Request,
  salvador: salvadorRequest as Request,
};
const cityNames: Record<City, string> = { goiania: 'Goiânia', salvador: 'Salvador' };
const artifactRoot = join(process.cwd(), 'artifacts', 'cdp-websocket', 'ifood');
const defaultEndpoint = 'https://browser.zyte.com/';
const actionTimeout = 10_000;

function message(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Remove terminal formatting and avoid persisting credentials from connection errors.
  const apiKey = process.env.API_KEY;
  const clean = text.replace(/\u001b\[[0-9;]*m/g, '');
  return apiKey
    ? clean.split(apiKey).join('<API_KEY>').split(Buffer.from(apiKey + ':').toString('base64')).join('<AUTH>')
    : clean;
}

function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function locatorFor(page: Page, selector?: ActionSelector): Locator {
  if (!selector) throw new Error('This action requires a selector.');
  // Explicit XPath is necessary for parenthesized and relative XPath expressions.
  // Zyte acts on the first match; first() also avoids Playwright strict-mode failures
  // for the optional, unindexed "Ver mais" selectors.
  return page.locator(selector.type === 'xpath' ? 'xpath=' + selector.value : selector.value).first();
}

export async function executeActions(
  page: Page,
  actions: Action[],
): Promise<{ results: ActionResult[]; selectedSuggestion: string | null }> {
  const results: ActionResult[] = [];
  let stopped = false;
  let selectedSuggestion: string | null = null;
  for (const [offset, action] of actions.entries()) {
    const started = Date.now();
    const result: ActionResult = {
      index: offset + 1,
      action: action.action,
      selector: action.selector?.value,
      status: stopped ? 'skipped' : 'success',
      onError: action.onError ?? 'return',
      durationMs: 0,
    };
    if (!stopped) {
      try {
        switch (action.action) {
          case 'waitForSelector':
            result.timeoutMs = (offset === 0 ? verificationWaitSeconds : action.timeout ?? 10) * 1_000;
            await locatorFor(page, action.selector).waitFor({
              state: action.selector?.state ?? 'visible',
              timeout: result.timeoutMs,
            });
            break;
          case 'click': {
            const target = locatorFor(page, action.selector);
            if (action.selector?.value.includes('btn-address--full-size')) {
              selectedSuggestion = await target.innerText({ timeout: actionTimeout });
            }
            await target.click({ timeout: actionTimeout });
            break;
          }
          case 'type':
            // These requests start with empty fields; fill enters the exact requested value.
            await locatorFor(page, action.selector).fill(action.text ?? '', { timeout: actionTimeout });
            break;
          case 'waitForTimeout':
            await page.waitForTimeout((action.timeout ?? 0) * 1_000);
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
      console.log('Action ' + result.index + '/' + actions.length + ' ' + result.action + ': ' + result.status);
    }
    results.push(result);
  }
  return { results, selectedSuggestion };
}

async function collectEvidence(page: Page, selectedSuggestion: string | null): Promise<Evidence> {
  const title = await page.title();
  const body = await page.locator('body').innerText({ timeout: 5_000 });
  const merchantNodes = page.locator('span[class*="merchant-v2__name"]');
  const merchantNames = (await merchantNodes.allTextContents()).map((name) => name.trim()).filter(Boolean);
  const merchantUrls = await merchantNodes.evaluateAll((nodes) =>
    nodes.map((node) => node.closest('a')?.getAttribute('href') ?? '').filter(Boolean),
  );
  const addressLabels = await page.locator(
    '.address-search-input--role-button, [class*="address-button"], [class*="delivery-address"], [class*="address-bar"]',
  ).allTextContents();
  return {
    title,
    bodyExcerpt: body.slice(0, 5_000),
    addressLabels: [...new Set(addressLabels.map((label) => label.trim()).filter(Boolean))],
    selectedSuggestion,
    merchantCount: merchantNames.length,
    merchantNames,
    merchantUrls,
    challengeDetected: /just a moment|security verification|verify.*not a bot|checking your browser/i.test(title + '\n' + body),
    blockDetected: /attention required|sorry, you have been blocked|access denied/i.test(title + '\n' + body),
  };
}

export async function runCity(city: City): Promise<Report> {
  const request = requests[city];
  const expectedAddress = request.actions.find((action) => action.action === 'type')?.text ?? '';
  const endpoint = new URL(process.env.ZYTE_CDP_ENDPOINT || defaultEndpoint);
  // Zyte API geolocation refers to the proxy country, not browser GPS coordinates.
  endpoint.searchParams.set('proxy_region', request.geolocation);
  endpoint.searchParams.set('proxy_type', 'residential');
  endpoint.searchParams.set('ttl', String(sessionTtlSeconds));
  const safeEndpoint = new URL(endpoint);
  safeEndpoint.username = '';
  safeEndpoint.password = '';
  const started = Date.now();
  const runDir = join(artifactRoot, new Date(started).toISOString().replace(/[:.]/g, '-') + '-' + city);
  mkdirSync(runDir, { recursive: true });
  const report: Report = {
    city, expectedAddress, startedAt: new Date(started).toISOString(), durationMs: 0,
    endpoint: safeEndpoint.toString(), proxyRegion: request.geolocation, proxyType: 'residential',
    verificationWaitSeconds, sessionTtlSeconds,
    httpStatus: null, finalUrl: null, success: false, failureReason: null,
    actions: [], evidence: null,
    validation: {
      requiredActionsSucceeded: false, addressMatches: false, merchantsVisible: false,
      merchantCityMatches: false, accessClear: false,
    },
    artifacts: {}, artifactErrors: [],
  };
  let session: ZyteCdpSession | null = null;
  try {
    session = await connectToZyteCdp({ endpoint: endpoint.toString() });
    const { page } = session;
    page.setDefaultTimeout(actionTimeout);
    console.log('\nTesting ' + cityNames[city] + ': ' + expectedAddress);
    report.httpStatus = (await navigateWithCdp(page, request.url, 60_000))?.status() ?? null;
    const execution = await executeActions(page, request.actions);
    report.actions = execution.results;
    report.evidence = await collectEvidence(page, execution.selectedSuggestion);
    const evidence = report.evidence;
    const addressTokens = expectedAddress.split(/,\s*/);
    const street = normalize(addressTokens[0].replace(/^Av\.\s*/i, ''));
    const number = addressTokens[1]?.match(/^\d+/)?.[0] ?? '';
    const suggestionMatches = normalize(evidence.selectedSuggestion ?? '').includes(normalize(cityNames[city]));
    const addressMatches = evidence.addressLabels.some((label) =>
      normalize(label).includes(street) && new RegExp('\\b' + number + '\\b').test(label),
    );
    report.validation = {
      requiredActionsSucceeded: execution.results.every((action) =>
        action.onError === 'continue' || action.status === 'success'),
      addressMatches: suggestionMatches && addressMatches,
      merchantsVisible: await page.locator('span[class*="merchant-v2__name"]').first().isVisible(),
      merchantCityMatches: evidence.merchantUrls.some((url) => normalize(url).includes(city)),
      accessClear: !evidence.challengeDetected && !evidence.blockDetected,
    };
    report.success = Object.values(report.validation).every(Boolean);
    const failedAction = execution.results.find((action) => action.status === 'error' && action.onError === 'return');
    report.failureReason = report.success ? null
      : evidence.blockDetected ? 'iFood returned a Cloudflare access block.'
      : evidence.challengeDetected ? 'iFood remained on the Cloudflare verification page.'
      : failedAction ? 'Required action ' + failedAction.index + ' (' + failedAction.action + ') failed: ' + failedAction.error
      : 'Result validation failed: ' + Object.entries(report.validation).filter(([, ok]) => !ok).map(([key]) => key).join(', ');
  } catch (error) {
    report.failureReason = message(error);
    if (session) {
      report.evidence = await collectEvidence(session.page, null).catch(() => null);
    }
  } finally {
    if (session) {
      report.finalUrl = session.page.url();
      if (request.browserHtml) {
        try {
          const htmlPath = join(runDir, 'browser.html');
          writeFileSync(htmlPath, await session.page.content(), 'utf8');
          report.artifacts.html = htmlPath;
        } catch (error) { report.artifactErrors.push('HTML: ' + message(error)); }
      }
      try {
        const screenshotPath = join(runDir, 'screenshot.png');
        await session.page.screenshot({ path: screenshotPath, fullPage: true, timeout: 10_000 });
        report.artifacts.screenshot = screenshotPath;
      } catch (error) { report.artifactErrors.push('Screenshot: ' + message(error)); }
    }
    await closeZyteCdp(session);
    report.durationMs = Date.now() - started;
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(cityNames[city] + ': ' + (report.success ? 'PASS' : 'FAIL') + ' — ' + (report.failureReason ?? evidenceSummary(report)));
    console.log('Report: ' + join(runDir, 'report.json'));
  }
  return report;
}

function evidenceSummary(report: Report): string {
  return report.evidence?.merchantCount + ' restaurants; address and city verified.';
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== 'goiania' && arg !== 'salvador' && arg !== 'all')) {
    throw new Error('Usage: npm run cdp:ifood -- [all|goiania|salvador]');
  }
  const cities: City[] = args.length === 0 || args.includes('all')
    ? ['goiania', 'salvador'] : [...new Set(args)] as City[];
  const reports: Report[] = [];
  for (const city of cities) reports.push(await runCity(city));
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, 'summary.json'), JSON.stringify(reports, null, 2) + '\n');
  if (reports.some((report) => !report.success)) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('iFood CDP test failed:', message(error));
    process.exitCode = 1;
  });
}
