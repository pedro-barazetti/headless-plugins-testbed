import "dotenv/config";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { chromium } from "playwright";

const URLS_INPUT_PATH = process.env.URLS_CSV_PATH
  ? resolve(process.cwd(), process.env.URLS_CSV_PATH)
  : resolve(process.cwd(), "input");
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 30000;
const MAX_CONCURRENCY = parsePositiveInteger(process.env.MAX_CONCURRENCY, 25);

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

  return resolve(outputDir, fileName);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isNaN(parsed) || parsed < 1) {
    return fallback;
  }

  return parsed;
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

type RequestedUrlEntry = {
  sourceFile: string;
  url: string;
};

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

async function main() {
  const requestedUrlEntries = await loadRequestedUrls(URLS_INPUT_PATH);
  const workerCount = Math.min(MAX_CONCURRENCY, requestedUrlEntries.length);
  const runOutputDir = resolve(process.cwd(), "output", `run_${createRunTimestamp()}`);

  if (requestedUrlEntries.length === 0) {
    throw new Error(`No URLs found in CSV input path: ${URLS_INPUT_PATH}`);
  }

  await mkdir(runOutputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    proxy: {
      server: PROXY_SERVER,
    },
    args: [
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-default-apps',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run'
    ]
  });

  const failures: Array<{ url: string; error: unknown }> = [];

  try {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 768 },
    });

    try {
      let nextIndex = 0;

      console.log(`Starting ${requestedUrlEntries.length} URL(s) with concurrency ${workerCount}.`);
      console.log(`Loaded CSV input path: ${URLS_INPUT_PATH}`);
      console.log(`Saving screenshots to: ${runOutputDir}`);

      await Promise.all(
        Array.from({ length: workerCount }, async (_, workerIndex) => {
          while (true) {
            const index = nextIndex;
            nextIndex += 1;

            if (index >= requestedUrlEntries.length) {
              return;
            }

            const { sourceFile, url } = requestedUrlEntries[index];
            let page;
            let screenshotPath: string | undefined;

            console.log(
              `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} visiting: ${url} (${sourceFile})`
            );

            try {
              page = await context.newPage();
              const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
              const status = response?.status();
              const statusLabel = status === undefined ? "no_status" : String(status);

              console.log(
                `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} status: ${statusLabel} ${url} (${sourceFile})`
              );

              await page.waitForLoadState("networkidle", { timeout: WAIT_MS }).catch(() => {
                console.warn(
                  `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} network idle timeout: ${url} (${sourceFile})`
                );
              });
              // screenshotPath = getScreenshotPath(runOutputDir, index, url, statusLabel);
              // await page.screenshot({ path: screenshotPath, fullPage: true });
              console.log(
                `[${index + 1}/${requestedUrlEntries.length}] Worker ${workerIndex + 1} screenshot saved: ${screenshotPath}`
              );
            } catch (error) {
              // if (page) {
              //   screenshotPath = getScreenshotPath(runOutputDir, index, url, "error");
              //   await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
              // }

              failures.push({ url, error });
              console.error(`[${index + 1}/${requestedUrlEntries.length}] Failed: ${url} (${sourceFile})`);
              // if (screenshotPath) {
              //   console.error(`[${index + 1}/${urls.length}] Screenshot saved: ${screenshotPath}`);
              // }
              console.error(error);
            } finally {
              await page?.close();
            }
          }
        })
      );
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }

  if (failures.length > 0) {
    throw new Error(`Finished with ${failures.length} failed URL(s).`);
  }

  console.log(`Finished successfully. Visited ${requestedUrlEntries.length} URL(s).`);
}

main().catch((error) => {
  console.error("Playwright CSV proxy script failed:", error);
  process.exit(1);
});