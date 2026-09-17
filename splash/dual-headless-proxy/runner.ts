import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_TARGET_URL =
  "https://caselook.clevelandheightscourt.com/disclaimer/1823";

export interface SplashComparisonTarget {
  name: string;
  outputDirectory: string;
  proxyHost: string;
  proxyProfile: string;
  splashUrl: string;
}

export interface SplashComparisonResult {
  elapsedMilliseconds: number;
  error?: string;
  finalUrl?: string;
  name: string;
  outputDirectory: string;
  pageTitle?: string;
  proxyHost: string;
  proxyProfile: string;
  renderedHtmlBytes: number;
  splashHttpStatus?: number;
  success: boolean;
  targetHttpStatus?: number;
  targetUrl: string;
}

interface SplashHistoryEntry {
  response?: {
    status?: number;
  };
}

interface SplashResult {
  geometry?: number[];
  history?: SplashHistoryEntry[];
  html?: string;
  png?: string;
  requestedUrl?: string;
  title?: string;
  url?: string;
}

function readPositiveNumber(name: string, fallback: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined) {
    return fallback;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number; received ${rawValue}`);
  }

  return value;
}

function getMainDocumentStatus(history: SplashHistoryEntry[] | undefined): number | undefined {
  if (!history) {
    return undefined;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const status = history[index]?.response?.status;
    if (typeof status === "number") {
      return status;
    }
  }

  return undefined;
}

function safeFileStem(urlString: string): string {
  const url = new URL(urlString);
  const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-");
  return `${url.hostname}-${path || "index"}`.toLowerCase();
}

async function saveMetadata(
  outputDirectory: string,
  fileStem: string,
  result: SplashComparisonResult,
  splashResult?: SplashResult,
): Promise<void> {
  const metadata = {
    ...result,
    geometry: splashResult?.geometry,
    historyEntryCount: splashResult?.history?.length ?? 0,
  };
  await writeFile(
    resolve(outputDirectory, `${fileStem}.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
}

export async function runSplashComparisonTarget(
  target: SplashComparisonTarget,
): Promise<SplashComparisonResult> {
  const targetUrl = process.env.TARGET_URL ?? DEFAULT_TARGET_URL;
  const waitSeconds = readPositiveNumber("SPLASH_WAIT_SECONDS", 5);
  const timeoutSeconds = readPositiveNumber("SPLASH_TIMEOUT_SECONDS", 150);
  const outputDirectory = resolve(process.cwd(), target.outputDirectory);
  const fileStem = safeFileStem(targetUrl);
  const splashEndpoint = new URL("/render.json", target.splashUrl);
  const startedAt = Date.now();

  await mkdir(outputDirectory, { recursive: true });

  console.log(`[${target.name}] Splash endpoint: ${splashEndpoint.toString()}`);
  console.log(`[${target.name}] Proxy host: ${target.proxyHost}`);
  console.log(`[${target.name}] Target URL: ${targetUrl}`);

  const baseResult: SplashComparisonResult = {
    elapsedMilliseconds: 0,
    name: target.name,
    outputDirectory,
    proxyHost: target.proxyHost,
    proxyProfile: target.proxyProfile,
    renderedHtmlBytes: 0,
    success: false,
    targetUrl,
  };

  let response: Response;
  try {
    response = await fetch(splashEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: targetUrl,
        proxy: target.proxyProfile,
        wait: waitSeconds,
        timeout: timeoutSeconds,
        resource_timeout: 120,
        viewport: "1366x768",
        render_all: 1,
        html: 1,
        png: 1,
        history: 1,
      }),
      signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000),
    });
  } catch (error: unknown) {
    const result = {
      ...baseResult,
      elapsedMilliseconds: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
    await saveMetadata(outputDirectory, fileStem, result);
    return result;
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 2_000);
    const result = {
      ...baseResult,
      elapsedMilliseconds: Date.now() - startedAt,
      error: `Splash returned HTTP ${response.status} ${response.statusText}: ${details}`,
      splashHttpStatus: response.status,
    };
    await saveMetadata(outputDirectory, fileStem, result);
    return result;
  }

  const splashResult = (await response.json()) as SplashResult;
  const targetHttpStatus = getMainDocumentStatus(splashResult.history);
  const renderedHtmlBytes = Buffer.byteLength(splashResult.html ?? "", "utf8");
  const success =
    renderedHtmlBytes > 0 &&
    (targetHttpStatus === undefined || targetHttpStatus < 400);
  const result: SplashComparisonResult = {
    ...baseResult,
    elapsedMilliseconds: Date.now() - startedAt,
    error:
      targetHttpStatus !== undefined && targetHttpStatus >= 400
        ? `Target navigation returned HTTP ${targetHttpStatus}`
        : renderedHtmlBytes === 0
          ? "Splash returned no rendered HTML"
          : undefined,
    finalUrl: splashResult.url,
    pageTitle: splashResult.title,
    renderedHtmlBytes,
    splashHttpStatus: response.status,
    success,
    targetHttpStatus,
  };

  if (splashResult.html !== undefined) {
    await writeFile(resolve(outputDirectory, `${fileStem}.html`), splashResult.html, "utf8");
  }
  if (splashResult.png !== undefined) {
    await writeFile(resolve(outputDirectory, `${fileStem}.png`), splashResult.png, "base64");
  }
  await saveMetadata(outputDirectory, fileStem, result, splashResult);

  return result;
}

export function printSplashComparisonResult(result: SplashComparisonResult): void {
  console.log(`[${result.name}] Splash HTTP status: ${result.splashHttpStatus ?? "unavailable"}`);
  console.log(`[${result.name}] Target HTTP status: ${result.targetHttpStatus ?? "unavailable"}`);
  console.log(`[${result.name}] Page title: ${result.pageTitle ?? "unavailable"}`);
  console.log(`[${result.name}] Rendered HTML bytes: ${result.renderedHtmlBytes}`);
  console.log(`[${result.name}] Elapsed: ${(result.elapsedMilliseconds / 1_000).toFixed(2)}s`);
  console.log(`[${result.name}] Result: ${result.success ? "success" : result.error ?? "failed"}`);
  console.log(`[${result.name}] Artifacts: ${result.outputDirectory}`);
}
