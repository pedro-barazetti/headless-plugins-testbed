import "dotenv/config";

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";

type Variant = "direct" | "zyte-proxy";

interface HarHeader {
  name?: string;
  value?: string;
}

interface HarEntry {
  request?: {
    url?: string;
  };
  response?: {
    status?: number;
    headers?: HarHeader[];
  };
}

interface SplashRenderResult {
  html?: string;
  script?: unknown;
  har?: {
    log?: {
      entries?: HarEntry[];
    };
  };
}

interface Sample {
  variant: Variant;
  run: number;
  durationMs: number;
  success: boolean;
  targetStatus?: number;
  selectorMatches?: number;
  zyteRequestId?: string;
  zyteErrorTitle?: string;
  error?: string;
}

interface Summary {
  attempts: number;
  successes: number;
  successRate: number;
  minMs: number | null;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
}

const config = {
  splashUrl: trimTrailingSlash(
    process.env.SPLASH_URL ?? `http://127.0.0.1:${process.env.SPLASH_PORT ?? "8050"}`,
  ),
  targetUrl: process.env.SPLASH_TARGET_URL ?? "https://toscrape.com/",
  expectedSelector: process.env.SPLASH_EXPECTED_SELECTOR ?? "h1",
  expectedText: process.env.SPLASH_EXPECTED_TEXT ?? "Web Scraping Sandbox",
  proxyProfile: process.env.SPLASH_PROXY_PROFILE ?? "zyte-api",
  runs: readPositiveInteger("SPLASH_RUNS", 5),
  warmupRuns: readNonNegativeInteger("SPLASH_WARMUP_RUNS", 1),
  waitSeconds: readNonNegativeNumber("SPLASH_WAIT_SECONDS", 1),
  timeoutSeconds: readPositiveNumber("SPLASH_TIMEOUT_SECONDS", 90),
  resourceTimeoutSeconds: readPositiveNumber("SPLASH_RESOURCE_TIMEOUT_SECONDS", 60),
  minSuccessRate: readRate("SPLASH_MIN_SUCCESS_RATE", 1),
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function readNumber(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") {
    return defaultValue;
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number, received ${JSON.stringify(rawValue)}`);
  }
  return value;
}

function readPositiveInteger(name: string, defaultValue: number): number {
  const value = readNumber(name, defaultValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function readNonNegativeInteger(name: string, defaultValue: number): number {
  const value = readNumber(name, defaultValue);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function readPositiveNumber(name: string, defaultValue: number): number {
  const value = readNumber(name, defaultValue);
  if (value <= 0) {
    throw new Error(`${name} must be greater than zero`);
  }
  return value;
}

function readNonNegativeNumber(name: string, defaultValue: number): number {
  const value = readNumber(name, defaultValue);
  if (value < 0) {
    throw new Error(`${name} must be zero or greater`);
  }
  return value;
}

function readRate(name: string, defaultValue: number): number {
  const value = readNumber(name, defaultValue);
  if (value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return value;
}

function percentile(sortedValues: number[], fraction: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const index = Math.ceil(fraction * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function summarize(samples: Sample[]): Summary {
  const successfulDurations = samples
    .filter((sample) => sample.success)
    .map((sample) => sample.durationMs)
    .sort((left, right) => left - right);
  const successes = successfulDurations.length;

  return {
    attempts: samples.length,
    successes,
    successRate: Math.round((successes / samples.length) * 10_000) / 10_000,
    minMs: successfulDurations.length > 0 ? successfulDurations[0] : null,
    meanMs:
      successfulDurations.length > 0
        ? round(
            successfulDurations.reduce((total, duration) => total + duration, 0) /
              successfulDurations.length,
          )
        : null,
    p50Ms: percentile(successfulDurations, 0.5),
    p95Ms: percentile(successfulDurations, 0.95),
    maxMs:
      successfulDurations.length > 0
        ? successfulDurations[successfulDurations.length - 1]
        : null,
  };
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  if (url.pathname !== "/") {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  return url.toString();
}

function findTargetEntry(entries: HarEntry[]): HarEntry | undefined {
  const expectedUrl = normalizeUrl(config.targetUrl);
  return entries.find((entry) => {
    try {
      return entry.request?.url !== undefined && normalizeUrl(entry.request.url) === expectedUrl;
    } catch {
      return false;
    }
  });
}

function findHeader(headers: HarHeader[], expectedName: string): string | undefined {
  return headers.find((header) => header.name?.toLowerCase() === expectedName.toLowerCase())
    ?.value;
}

function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 500);
}

async function assertSplashIsReady(): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${config.splashUrl}/_ping`, {
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    throw new Error(
      `Splash is not reachable at ${config.splashUrl}. Start it with npm run splash-up. ${shortError(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`Splash health check returned HTTP ${response.status}`);
  }
}

async function detectSplashVersion(): Promise<string | undefined> {
  try {
    const response = await fetch(`${config.splashUrl}/`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return undefined;
    }

    const html = await response.text();
    return html.match(/<title>\s*Splash\s+([^|<\s]+)/i)?.[1];
  } catch {
    return undefined;
  }
}

async function render(variant: Variant, run: number): Promise<Sample> {
  const startedAt = performance.now();
  const diagnostics: Partial<Sample> = {};
  const proxy = variant === "direct" ? "none" : config.proxyProfile;
  const requestBody: Record<string, unknown> = {
    url: config.targetUrl,
    proxy,
    wait: config.waitSeconds,
    timeout: config.timeoutSeconds,
    resource_timeout: config.resourceTimeoutSeconds,
    images: 0,
    http2: 0,
    html: 1,
    har: 1,
    script: 1,
    js_source: `document.querySelectorAll(${JSON.stringify(config.expectedSelector)}).length`,
  };

  if (variant === "zyte-proxy") {
    requestBody.headers = {
      "Zyte-Client": "splash-compatibility-test/1.0",
    };
  }

  try {
    const response = await fetch(`${config.splashUrl}/render.json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout((config.timeoutSeconds + 10) * 1_000),
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Splash returned HTTP ${response.status}: ${responseText.slice(0, 300)}`);
    }

    const result = JSON.parse(responseText) as SplashRenderResult;
    const html = result.html ?? "";
    const selectorMatches =
      typeof result.script === "number" ? result.script : Number(result.script ?? 0);
    const targetEntry = findTargetEntry(result.har?.log?.entries ?? []);
    const targetStatus = targetEntry?.response?.status;
    const zyteRequestId = findHeader(
      targetEntry?.response?.headers ?? [],
      "Zyte-Request-ID",
    );
    const zyteErrorTitle = findHeader(
      targetEntry?.response?.headers ?? [],
      "Zyte-Error-Title",
    );

    diagnostics.targetStatus = targetStatus;
    diagnostics.selectorMatches = selectorMatches;
    diagnostics.zyteRequestId = zyteRequestId;
    diagnostics.zyteErrorTitle = zyteErrorTitle;

    if (targetStatus === undefined || targetStatus < 200 || targetStatus >= 400) {
      throw new Error(
        `target response status was ${targetStatus ?? "missing from HAR"}${
          zyteErrorTitle ? ` (${zyteErrorTitle})` : ""
        }`,
      );
    }
    if (variant === "zyte-proxy" && !zyteRequestId) {
      throw new Error(
        "target response did not include Zyte-Request-ID; proxy use could not be verified",
      );
    }
    if (!Number.isFinite(selectorMatches) || selectorMatches < 1) {
      throw new Error(
        `rendered DOM did not contain selector ${JSON.stringify(config.expectedSelector)}`,
      );
    }
    if (config.expectedText !== "" && !html.includes(config.expectedText)) {
      throw new Error(
        `rendered HTML did not contain ${JSON.stringify(config.expectedText)}`,
      );
    }

    return {
      variant,
      run,
      durationMs: round(performance.now() - startedAt),
      success: true,
      ...diagnostics,
    };
  } catch (error) {
    return {
      variant,
      run,
      durationMs: round(performance.now() - startedAt),
      success: false,
      ...diagnostics,
      error: shortError(error),
    };
  }
}

function printSample(sample: Sample, warmup: boolean): void {
  const label = warmup ? "warm-up" : `run ${sample.run}`;
  const status = sample.success ? "passed" : `failed: ${sample.error}`;
  console.log(
    `[${sample.variant.padEnd(10)}] ${label.padEnd(9)} ${String(sample.durationMs).padStart(9)} ms  ${status}`,
  );
}

async function main(): Promise<void> {
  await assertSplashIsReady();

  console.log(`Splash: ${config.splashUrl}`);
  console.log(`Target: ${config.targetUrl}`);
  console.log(
    `Plan: ${config.warmupRuns} warm-up + ${config.runs} measured request(s) per variant`,
  );

  for (let run = 1; run <= config.warmupRuns; run += 1) {
    for (const variant of ["direct", "zyte-proxy"] as const) {
      const sample = await render(variant, run);
      printSample(sample, true);
    }
  }

  const samples: Sample[] = [];
  for (let run = 1; run <= config.runs; run += 1) {
    const variants: Variant[] =
      run % 2 === 1 ? ["direct", "zyte-proxy"] : ["zyte-proxy", "direct"];
    for (const variant of variants) {
      const sample = await render(variant, run);
      samples.push(sample);
      printSample(sample, false);
    }
  }

  const splashVersion = await detectSplashVersion();

  const directSummary = summarize(samples.filter((sample) => sample.variant === "direct"));
  const proxySummary = summarize(
    samples.filter((sample) => sample.variant === "zyte-proxy"),
  );
  const compatible =
    directSummary.successRate >= config.minSuccessRate &&
    proxySummary.successRate >= config.minSuccessRate;
  const medianOverheadMs =
    directSummary.p50Ms !== null && proxySummary.p50Ms !== null
      ? round(proxySummary.p50Ms - directSummary.p50Ms)
      : null;
  const medianOverheadPercent =
    medianOverheadMs !== null && directSummary.p50Ms !== null && directSummary.p50Ms > 0
      ? round((medianOverheadMs / directSummary.p50Ms) * 100)
      : null;

  console.table([
    { variant: "Direct Splash", ...directSummary },
    { variant: "Splash + Zyte API", ...proxySummary },
  ]);
  console.log(
    medianOverheadMs === null
      ? "Median proxy overhead: unavailable"
      : `Median proxy overhead: ${medianOverheadMs} ms (${medianOverheadPercent}%)`,
  );

  const timestamp = new Date().toISOString();
  const defaultResultFile = resolve(
    "output",
    `splash-zyte-api-proxy-${timestamp.replace(/[:.]/g, "-")}.json`,
  );
  const resultFile = resolve(process.env.SPLASH_RESULT_FILE ?? defaultResultFile);
  const report = {
    schemaVersion: 1,
    generatedAt: timestamp,
    compatible,
    splashVersion,
    config,
    summary: {
      direct: directSummary,
      zyteProxy: proxySummary,
      medianOverheadMs,
      medianOverheadPercent,
    },
    samples,
  };

  mkdirSync(dirname(resultFile), { recursive: true });
  writeFileSync(resultFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Report: ${resultFile}`);

  if (!compatible) {
    throw new Error(
      `Compatibility threshold was not met (required success rate: ${config.minSuccessRate})`,
    );
  }

  console.log("Compatibility: PASS");
}

main().catch((error) => {
  console.error(`Splash/Zyte API compatibility test failed: ${shortError(error)}`);
  process.exitCode = 1;
});
