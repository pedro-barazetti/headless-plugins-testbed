import "dotenv/config";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { chromium, type Page } from "playwright";

const DEFAULT_URLS_INPUT_PATH = resolve(
  process.cwd(),
  "output/proxy-comparison-render-2026-09-17/render_urls.csv"
);
const URLS_INPUT_PATH = process.env.URLS_CSV_PATH
  ? resolve(process.cwd(), process.env.URLS_CSV_PATH)
  : DEFAULT_URLS_INPUT_PATH;
const ZYTE_API_KEY = (process.env.ZYTE_API_KEY ?? process.env.API_KEY ?? "").trim();
const ZYTE_API_PROXY_SERVER = process.env.ZYTE_API_PROXY_SERVER ?? "http://api.zyte.com:8011";
const ZYTE_IP_TYPE = process.env.ZYTE_IP_TYPE?.trim();
const HEADLESS = process.env.HEADLESS?.toLowerCase() !== "false";
const SAVE_SCREENSHOTS = process.env.SAVE_SCREENSHOTS?.toLowerCase() === "true";
const WAIT_FOR_NETWORK_IDLE = process.env.WAIT_FOR_NETWORK_IDLE?.toLowerCase() !== "false";
const NETWORK_IDLE_TIMEOUT_MS = parsePositiveInteger(process.env.NETWORK_IDLE_TIMEOUT_MS, 5000);
const NAVIGATION_TIMEOUT_MS = parsePositiveInteger(process.env.NAVIGATION_TIMEOUT_MS, 60000);
const MAX_CONCURRENCY = parsePositiveInteger(process.env.MAX_CONCURRENCY, 8);
const PROXY_CONNECTION_MAX_ATTEMPTS = parsePositiveInteger(process.env.PROXY_CONNECTION_MAX_ATTEMPTS, 3);
const PROXY_RETRY_BASE_DELAY_MS = parsePositiveInteger(process.env.PROXY_RETRY_BASE_DELAY_MS, 1000);
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";

type Region = "BR" | "US";

type RequestedUrlEntry = {
  sourceFile: string;
  url: string;
};

type TestResult = {
  index: number;
  sourceFile: string;
  url: string;
  finalUrl?: string;
  region: Region;
  sessionId: string;
  attempts: number;
  proxyConnectionFailures: number;
  status?: number;
  navigationElapsedMs?: number;
  elapsedMs: number;
  networkIdleTimedOut?: boolean;
  zyteRequestId?: string;
  zyteErrorTitle?: string;
  zyteErrorType?: string;
  crawleraError?: string;
  failedDocumentRequests: number;
  failedSubresourceRequests: number;
  failedSubresourceProxyConnections: number;
  abortedSubresourceRequests: number;
  failedSubresourceSamples: Array<{ url: string; resourceType: string; failure: string | null }>;
  bodyTextLength?: number;
  bodyElementCount?: number;
  embeddedContentCount?: number;
  basicContentCheckPassed?: boolean;
  screenshotPath?: string;
  error?: string;
};

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
}

function getRegionForUrl(targetURL: string): Region {
  if (targetURL.includes("com.br") && targetURL.includes("econet")) {
    return "US";
  }

  if (targetURL.includes("com.br") || targetURL.includes("gov.br")) {
    return "BR";
  }

  return "US";
}

function createRunTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "page";
}

function getScreenshotPath(outputDir: string, index: number, url: string, statusLabel: string): string {
  const urlObject = new URL(url);
  const host = sanitizeFileSegment(urlObject.hostname);
  const pathSegment = sanitizeFileSegment(urlObject.pathname === "/" ? "root" : urlObject.pathname);
  const fileName = `${String(index + 1).padStart(4, "0")}_${host}_${pathSegment}_${statusLabel}.png`;

  return resolve(outputDir, "screenshots", fileName);
}

function parseRequestedUrls(csvContent: string): string[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return [];
  }

  const dataLines = lines[0].toLowerCase() === "requested_url" ? lines.slice(1) : lines;

  return dataLines
    .map((line) => line.replace(/^"|"$/g, "").trim())
    .filter((line) => line.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function isProxyConnectionFailure(error: unknown): boolean {
  return errorMessage(error).includes("net::ERR_PROXY_CONNECTION_FAILED");
}

function proxyRetryDelayMs(attempt: number): number {
  return PROXY_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getCsvInputPaths(inputPath: string): Promise<string[]> {
  const inputStats = await stat(inputPath);

  if (inputStats.isFile()) {
    return [inputPath];
  }

  if (!inputStats.isDirectory()) {
    throw new Error(`Input path is neither a file nor a directory: ${inputPath}`);
  }

  const entries = await readdir(inputPath, { withFileTypes: true });
  const csvPaths = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => resolve(inputPath, entry.name))
    .sort((left, right) => left.localeCompare(right));

  if (csvPaths.length === 0) {
    throw new Error(`No CSV files found in input directory: ${inputPath}`);
  }

  return csvPaths;
}

async function loadRequestedUrls(inputPath: string): Promise<RequestedUrlEntry[]> {
  const csvPaths = await getCsvInputPaths(inputPath);
  const requestedUrlEntries: RequestedUrlEntry[] = [];

  for (const csvPath of csvPaths) {
    const csvContent = await readFile(csvPath, "utf8");
    const sourceFile = basename(csvPath);
    const urls = parseRequestedUrls(csvContent);

    for (const url of urls) {
      requestedUrlEntries.push({ sourceFile, url });
    }
  }

  return requestedUrlEntries;
}

async function captureErrorScreenshot(page: Page | undefined, screenshotPath: string): Promise<string | undefined> {
  if (!page || !SAVE_SCREENSHOTS) {
    return undefined;
  }

  await mkdir(dirname(screenshotPath), { recursive: true });
  return page.screenshot({ path: screenshotPath, fullPage: true }).then(
    () => screenshotPath,
    () => undefined
  );
}

async function main() {
  if (!ZYTE_API_KEY) {
    throw new Error("Missing Zyte API key. Set ZYTE_API_KEY or API_KEY in the environment.");
  }

  const requestedUrlEntries = await loadRequestedUrls(URLS_INPUT_PATH);

  if (requestedUrlEntries.length === 0) {
    throw new Error(`No URLs found in CSV input path: ${URLS_INPUT_PATH}`);
  }

  const workerCount = Math.min(MAX_CONCURRENCY, requestedUrlEntries.length);
  const runOutputDir = process.env.OUTPUT_DIR
    ? resolve(process.cwd(), process.env.OUTPUT_DIR)
    : resolve(process.cwd(), "output", "zyte-api-direct", `run_${createRunTimestamp()}`);
  const resultsPath = process.env.RESULTS_PATH
    ? resolve(process.cwd(), process.env.RESULTS_PATH)
    : resolve(runOutputDir, "results.json");

  await mkdir(runOutputDir, { recursive: true });
  await mkdir(dirname(resultsPath), { recursive: true });

  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    console.warn("Interrupt requested; finishing active URLs and saving partial results.");
  };
  process.once("SIGINT", requestStop);

  const browser = await chromium.launch({
    headless: HEADLESS,
    handleSIGINT: false,
    proxy: {
      server: ZYTE_API_PROXY_SERVER,
      username: ZYTE_API_KEY,
      password: "",
    },
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-certificate-errors",
      "--disable-web-security",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--metrics-recording-only",
      "--no-first-run",
    ],
  });

  const failures: Array<{ url: string; error: unknown }> = [];
  const results: TestResult[] = [];
  let snapshotWrite = Promise.resolve();
  const recordResult = (result: TestResult) => {
    results.push(result);
    if (results.length % 100 === 0) {
      const snapshot = JSON.stringify([...results].sort((left, right) => left.index - right.index), null, 2);
      snapshotWrite = snapshotWrite.then(() => writeFile(resultsPath, `${snapshot}\n`, "utf8")).catch((error) => {
        console.warn(`Could not save progress snapshot: ${errorMessage(error)}`);
      });
    }
  };

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
    });

    try {
      let nextIndex = 0;

      console.log(`Starting ${requestedUrlEntries.length} URL(s) with concurrency ${workerCount}.`);
      console.log(`Loaded CSV input path: ${URLS_INPUT_PATH}`);
      console.log(`Zyte API proxy: ${ZYTE_API_PROXY_SERVER}`);
      console.log(`Zyte IP type: ${ZYTE_IP_TYPE || "default"}`);
      console.log(`Headless: ${HEADLESS}`);
      console.log(`Proxy connection max attempts: ${PROXY_CONNECTION_MAX_ATTEMPTS}`);
      console.log(`Wait for network idle: ${WAIT_FOR_NETWORK_IDLE}`);
      console.log(`Network idle timeout: ${NETWORK_IDLE_TIMEOUT_MS}ms`);
      console.log(`Save screenshots: ${SAVE_SCREENSHOTS}`);
      console.log(`Run output directory: ${runOutputDir}`);

      await Promise.all(
        Array.from({ length: workerCount }, async (_, workerIndex) => {
          while (true) {
            if (stopRequested) {
              return;
            }
            const index = nextIndex;
            nextIndex += 1;

            if (index >= requestedUrlEntries.length) {
              return;
            }

            const { sourceFile, url } = requestedUrlEntries[index];
            const region = getRegionForUrl(url);
            const sessionId = randomUUID();
            const startedAt = Date.now();
            let attempt = 0;
            let proxyConnectionFailures = 0;

            console.log(
              `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} visiting with region ${region}: ${url} (${sourceFile})`
            );

            while (attempt < PROXY_CONNECTION_MAX_ATTEMPTS) {
              attempt += 1;
              let page: Page | undefined;
              let failedDocumentRequests = 0;
              let failedSubresourceRequests = 0;
              let failedSubresourceProxyConnections = 0;
              let abortedSubresourceRequests = 0;
              const failedSubresourceSamples: TestResult["failedSubresourceSamples"] = [];

              try {
                page = await context.newPage();
                page.on("requestfailed", (request) => {
                  if (request.resourceType() === "document") {
                    failedDocumentRequests += 1;
                  } else {
                    failedSubresourceRequests += 1;
                    const failure = request.failure()?.errorText ?? null;
                    if (failure?.includes("ERR_PROXY_CONNECTION_FAILED")) {
                      failedSubresourceProxyConnections += 1;
                    }
                    if (failure?.includes("ERR_ABORTED")) {
                      abortedSubresourceRequests += 1;
                    }
                    if (failedSubresourceSamples.length < 5) {
                      failedSubresourceSamples.push({
                        url: request.url(),
                        resourceType: request.resourceType(),
                        failure,
                      });
                    }
                  }
                });
                await page.setExtraHTTPHeaders({
                  "Zyte-Browser-Html": "false",
                  "Zyte-Client": "zyte-headless-plugins-testbed/playwright-direct",
                  "Zyte-Geolocation": region,
                  "Zyte-Override-Headers": "User-Agent",
                  "Zyte-Session-ID": sessionId,
                  ...(ZYTE_IP_TYPE ? { "Zyte-IPType": ZYTE_IP_TYPE } : {}),
                });

                const response = await page.goto(url, {
                  waitUntil: "domcontentloaded",
                  timeout: NAVIGATION_TIMEOUT_MS,
                });
                const navigationElapsedMs = Date.now() - startedAt;
                const status = response?.status();
                const statusLabel = status === undefined ? "no_status" : String(status);
                const responseHeaders = response ? await response.allHeaders() : {};
                let networkIdleTimedOut: boolean | undefined;

                console.log(
                  `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} status: ${statusLabel} ${url} (${sourceFile})`
                );

                if (WAIT_FOR_NETWORK_IDLE) {
                  networkIdleTimedOut = false;
                  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {
                    networkIdleTimedOut = true;
                    console.warn(
                      `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} network idle timeout: ${url} (${sourceFile})`
                    );
                  });
                }

                const content = await page.evaluate(() => ({
                  bodyTextLength: document.body?.innerText.trim().length ?? 0,
                  bodyElementCount: document.body?.children.length ?? 0,
                  embeddedContentCount: document.body?.querySelectorAll("img,svg,video,canvas,iframe,embed,object").length ?? 0,
                }));
                const basicContentCheckPassed =
                  content.bodyTextLength >= 40 || content.embeddedContentCount > 0;

                let screenshotPath: string | undefined;
                if (SAVE_SCREENSHOTS) {
                  screenshotPath = getScreenshotPath(runOutputDir, index, url, statusLabel);
                  await mkdir(dirname(screenshotPath), { recursive: true });
                  await page.screenshot({ path: screenshotPath, fullPage: true });
                  console.log(
                    `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} screenshot saved: ${screenshotPath}`
                  );
                }

                recordResult({
                  index,
                  sourceFile,
                  url,
                  finalUrl: response?.url(),
                  region,
                  sessionId,
                  attempts: attempt,
                  proxyConnectionFailures,
                  status,
                  navigationElapsedMs,
                  elapsedMs: Date.now() - startedAt,
                  networkIdleTimedOut,
                  zyteRequestId: responseHeaders["zyte-request-id"],
                  zyteErrorTitle: responseHeaders["zyte-error-title"],
                  zyteErrorType: responseHeaders["zyte-error-type"],
                  crawleraError: responseHeaders["x-crawlera-error"],
                  failedDocumentRequests,
                  failedSubresourceRequests,
                  failedSubresourceProxyConnections,
                  abortedSubresourceRequests,
                  failedSubresourceSamples,
                  ...content,
                  basicContentCheckPassed,
                  screenshotPath,
                });
                break;
              } catch (error) {
                if (isProxyConnectionFailure(error)) {
                  proxyConnectionFailures += 1;
                }

                if (isProxyConnectionFailure(error) && attempt < PROXY_CONNECTION_MAX_ATTEMPTS) {
                  const retryDelayMs = proxyRetryDelayMs(attempt);
                  console.warn(
                    `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} proxy connection failed; retrying attempt ${attempt + 1}/${PROXY_CONNECTION_MAX_ATTEMPTS} in ${retryDelayMs}ms: ${url}`
                  );
                  await page?.close();
                  page = undefined;
                  await delay(retryDelayMs);
                  continue;
                }

                const screenshotPath = getScreenshotPath(runOutputDir, index, url, "error");
                const savedScreenshotPath = await captureErrorScreenshot(page, screenshotPath);

                failures.push({ url, error });
                recordResult({
                  index,
                  sourceFile,
                  url,
                  region,
                  sessionId,
                  attempts: attempt,
                  proxyConnectionFailures,
                  elapsedMs: Date.now() - startedAt,
                  failedDocumentRequests,
                  failedSubresourceRequests,
                  failedSubresourceProxyConnections,
                  abortedSubresourceRequests,
                  failedSubresourceSamples,
                  screenshotPath: savedScreenshotPath,
                  error: errorMessage(error),
                });
                console.error(`[${index + 1}/${requestedUrlEntries.length}] Failed: ${url} (${sourceFile})`);
                console.error(error);
                break;
              } finally {
                await page?.close();
              }
            }
          }
        })
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
    process.removeListener("SIGINT", requestStop);
  }

  await snapshotWrite;
  await writeFile(
    resultsPath,
    `${JSON.stringify(results.sort((left, right) => left.index - right.index), null, 2)}\n`,
    "utf8"
  );
  console.log(`Saved results to: ${resultsPath}`);

  if (stopRequested) {
    console.warn(`Stopped after ${results.length}/${requestedUrlEntries.length} URL(s).`);
    process.exitCode = 130;
    return;
  }

  if (failures.length > 0) {
    throw new Error(`Finished with ${failures.length} failed URL(s).`);
  }

  console.log(`Finished successfully. Visited ${requestedUrlEntries.length} URL(s).`);
}

main().catch((error) => {
  console.error("Direct Zyte API Playwright CSV script failed:", error);
  process.exit(1);
});
