import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Agent } from "node:http";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import axios, { AxiosError, AxiosInstance } from "axios";
import { parse } from "csv-parse/sync";

const { HttpsProxyAgent } = require("https-proxy-agent") as {
  HttpsProxyAgent: new (
    proxy: string,
    options?: { rejectUnauthorized?: boolean }
  ) => Agent;
};
const { HttpProxyAgent } = require("http-proxy-agent") as {
  HttpProxyAgent: new (proxy: string) => Agent;
};

const INPUT_PATH = resolve(
  process.cwd(),
  process.env.URLS_CSV_PATH ?? "proxy-enabled-urls.csv"
);
const OUTPUT_DIR = resolve(
  process.cwd(),
  process.env.OUTPUT_DIR ?? `output/axios_proxy_comparison_${runTimestamp()}`
);
const FILTER_RESOLVER = process.env.FILTER_RESOLVER ?? "render_less";
const MAX_CONCURRENCY = positiveInteger(process.env.MAX_CONCURRENCY, 125);
const MAX_ROWS = optionalPositiveInteger(process.env.MAX_ROWS);
const REQUEST_TIMEOUT_MS = positiveInteger(process.env.REQUEST_TIMEOUT_MS, 60_000);
const PROGRESS_INTERVAL = positiveInteger(process.env.PROGRESS_INTERVAL, 100);
const ERROR_BODY_EXCERPT_BYTES = 2_048;

type CsvRow = Record<string, string>;

type ProxyConfig = {
  label: "zyte_api" | "spm";
  host: string;
  port: number;
  apiKey: string;
};

type TunnelProxyAgent = Agent & {
  connect: (
    request: unknown,
    options: Record<string, unknown>
  ) => Promise<unknown>;
};

type ProxyResult = {
  status?: number;
  elapsedMs: number;
  bodyBytes: number;
  finalUrl?: string;
  contentType?: string;
  requestId?: string;
  proxyError?: string;
  bodyExcerpt?: string;
  errorCode?: string;
  error?: string;
};

type ComparisonResult = {
  index: number;
  id?: string;
  name?: string;
  namespace?: string;
  url: string;
  historicalProxyProvider?: string;
  expectedHttpStatus?: string;
  zyteApi: ProxyResult;
  spm: ProxyResult;
};

function runTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received: ${value}`);
  }

  return parsed;
}

function requiredEnvironmentVariable(names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  throw new Error(`Missing required environment variable; set one of: ${names.join(", ")}`);
}

function proxyConfig(
  label: ProxyConfig["label"],
  prefix: "ZYTE_API" | "SPM",
  defaultHost: string,
  apiKeyFallbacks: string[]
): ProxyConfig {
  return {
    label,
    host: process.env[`${prefix}_PROXY_HOST`]?.trim() || defaultHost,
    port: positiveInteger(process.env[`${prefix}_PROXY_PORT`], 8011),
    apiKey: requiredEnvironmentVariable([
      `${prefix}_PROXY_APIKEY`,
      ...apiKeyFallbacks,
    ]),
  };
}

function createProxyClient(config: ProxyConfig): AxiosInstance {
  const username = encodeURIComponent(config.apiKey);
  const proxyUrl = `http://${username}:@${config.host}:${config.port}`;
  const httpProxyAgent = new HttpProxyAgent(proxyUrl);
  const httpsProxyAgent = new HttpsProxyAgent(proxyUrl) as TunnelProxyAgent;
  const connectThroughProxy = httpsProxyAgent.connect.bind(httpsProxyAgent);

  // The proxies terminate TLS with their own CA. Apply this to the tunneled
  // destination connection; constructor options only configure TLS to an
  // HTTPS proxy endpoint and do not affect the post-CONNECT TLS handshake.
  httpsProxyAgent.connect = (request, options) =>
    connectThroughProxy(request, { ...options, rejectUnauthorized: false });

  return axios.create({
    httpAgent: httpProxyAgent,
    httpsAgent: httpsProxyAgent,
    proxy: false,
    timeout: REQUEST_TIMEOUT_MS,
    maxRedirects: 10,
    responseType: "stream",
    validateStatus: () => true,
    headers: {
      Accept: "*/*",
      "User-Agent": "zyte-headless-plugins-testbed/axios-proxy-comparison",
    },
  });
}

function errorDetails(error: unknown): Pick<ProxyResult, "errorCode" | "error"> {
  if (error instanceof AxiosError) {
    return {
      errorCode: error.code,
      error: error.message,
    };
  }

  if (error instanceof Error) {
    const errorWithCode = error as Error & { code?: string };
    return {
      errorCode: errorWithCode.code,
      error: `${error.name}: ${error.message}`,
    };
  }

  return { error: String(error) };
}

function headerString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join(", ") : String(value);
}

async function requestUrl(client: AxiosInstance, url: string): Promise<ProxyResult> {
  const startedAt = performance.now();
  let bodyBytes = 0;
  let bodyExcerptBuffer = Buffer.alloc(0);

  try {
    const response = await client.get<NodeJS.ReadableStream>(url);

    try {
      for await (const chunk of response.data) {
        const chunkBuffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        bodyBytes += chunkBuffer.length;

        if (bodyExcerptBuffer.length < ERROR_BODY_EXCERPT_BYTES) {
          const remainingBytes = ERROR_BODY_EXCERPT_BYTES - bodyExcerptBuffer.length;
          bodyExcerptBuffer = Buffer.concat([
            bodyExcerptBuffer,
            chunkBuffer.subarray(0, remainingBytes),
          ]);
        }
      }

      return {
        status: response.status,
        elapsedMs: Math.round(performance.now() - startedAt),
        bodyBytes,
        finalUrl: response.request?.res?.responseUrl ?? url,
        contentType: headerString(response.headers["content-type"]),
        requestId: headerString(response.headers["zyte-request-id"]),
        proxyError: headerString(response.headers["x-crawlera-error"]),
        bodyExcerpt:
          response.status >= 400 ? bodyExcerptBuffer.toString("utf8") : undefined,
      };
    } catch (error) {
      return {
        status: response.status,
        elapsedMs: Math.round(performance.now() - startedAt),
        bodyBytes,
        finalUrl: response.request?.res?.responseUrl ?? url,
        contentType: headerString(response.headers["content-type"]),
        requestId: headerString(response.headers["zyte-request-id"]),
        proxyError: headerString(response.headers["x-crawlera-error"]),
        bodyExcerpt: bodyExcerptBuffer.toString("utf8") || undefined,
        ...errorDetails(error),
      };
    }
  } catch (error) {
    return {
      elapsedMs: Math.round(performance.now() - startedAt),
      bodyBytes,
      ...errorDetails(error),
    };
  }
}

function loadInputRows(csvContent: string): CsvRow[] {
  const rows = parse(csvContent, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];

  return rows.filter(
    (row) =>
      row.resolver?.trim().toLowerCase() === FILTER_RESOLVER.toLowerCase() &&
      Boolean(row.start_url?.trim())
  );
}

function csvCell(value: unknown): string {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resultOutcome(result: ProxyResult): string {
  if (result.error) return "request_error";
  if (result.status === undefined) return "no_status";
  if (result.status >= 200 && result.status < 300) return "http_2xx";
  return "http_non_2xx";
}

function comparisonCategory(result: ComparisonResult): string {
  const zytePassed = result.zyteApi.status === 200 && !result.zyteApi.error;
  const spmPassed = result.spm.status === 200 && !result.spm.error;

  if (zytePassed && spmPassed) return "both_http_200";
  if (zytePassed) return "zyte_api_only_http_200";
  if (spmPassed) return "spm_only_http_200";
  return "neither_http_200";
}

function assertProxyAuthentication(
  label: string,
  result: ProxyResult,
  environmentVariables: string[]
): void {
  if (result.status !== 407 && result.proxyError !== "bad_proxy_auth") return;

  throw new Error(
    `${label} proxy rejected its credentials` +
      ` (HTTP ${result.status ?? "unknown"}, proxy error: ${result.proxyError ?? "unknown"}). ` +
      `Update one of: ${environmentVariables.join(", ")}`
  );
}

function resultsCsv(results: ComparisonResult[]): string {
  const headers = [
    "row_number",
    "id",
    "name",
    "namespace",
    "url",
    "historical_proxy_provider",
    "expected_http_status",
    "zyte_api_outcome",
    "zyte_api_status",
    "zyte_api_elapsed_ms",
    "zyte_api_body_bytes",
    "zyte_api_request_id",
    "zyte_api_proxy_error",
    "zyte_api_body_excerpt",
    "zyte_api_error_code",
    "zyte_api_error",
    "spm_outcome",
    "spm_status",
    "spm_elapsed_ms",
    "spm_body_bytes",
    "spm_request_id",
    "spm_proxy_error",
    "spm_body_excerpt",
    "spm_error_code",
    "spm_error",
    "comparison",
  ];
  const lines = [headers.join(",")];

  for (const result of results) {
    lines.push(
      [
        result.index + 1,
        result.id,
        result.name,
        result.namespace,
        result.url,
        result.historicalProxyProvider,
        result.expectedHttpStatus,
        resultOutcome(result.zyteApi),
        result.zyteApi.status,
        result.zyteApi.elapsedMs,
        result.zyteApi.bodyBytes,
        result.zyteApi.requestId,
        result.zyteApi.proxyError,
        result.zyteApi.bodyExcerpt,
        result.zyteApi.errorCode,
        result.zyteApi.error,
        resultOutcome(result.spm),
        result.spm.status,
        result.spm.elapsedMs,
        result.spm.bodyBytes,
        result.spm.requestId,
        result.spm.proxyError,
        result.spm.bodyExcerpt,
        result.spm.errorCode,
        result.spm.error,
        comparisonCategory(result),
      ]
        .map(csvCell)
        .join(",")
    );
  }

  return `${lines.join("\n")}\n`;
}

function summarizeProxy(results: ComparisonResult[], key: "zyteApi" | "spm") {
  const proxyResults = results.map((result) => result[key]);
  const statuses: Record<string, number> = {};
  const errorCodes: Record<string, number> = {};

  for (const result of proxyResults) {
    if (result.status !== undefined) {
      statuses[String(result.status)] = (statuses[String(result.status)] ?? 0) + 1;
    }
    if (result.errorCode || result.error) {
      const errorKey = result.errorCode ?? result.error ?? "unknown";
      errorCodes[errorKey] = (errorCodes[errorKey] ?? 0) + 1;
    }
  }

  const http200 = proxyResults.filter((result) => result.status === 200 && !result.error).length;
  const http2xx = proxyResults.filter(
    (result) =>
      result.status !== undefined &&
      result.status >= 200 &&
      result.status < 300 &&
      !result.error
  ).length;
  const errors = proxyResults.filter((result) => Boolean(result.error)).length;
  const httpResponses = proxyResults.filter((result) => result.status !== undefined).length;
  const httpNon2xx = proxyResults.filter(
    (result) =>
      result.status !== undefined && (result.status < 200 || result.status >= 300)
  ).length;
  const proxyErrors = proxyResults.filter((result) => Boolean(result.proxyError)).length;

  return {
    rows: proxyResults.length,
    httpResponses,
    http200,
    http200RatePercent: Number(((http200 / proxyResults.length) * 100).toFixed(2)),
    http2xx,
    httpNon2xx,
    proxyErrors,
    errors,
    errorRatePercent: Number(((errors / proxyResults.length) * 100).toFixed(2)),
    totalBodyBytes: proxyResults.reduce((total, result) => total + result.bodyBytes, 0),
    statuses,
    errorCodes,
  };
}

async function main() {
  const zyteApiConfig = proxyConfig(
    "zyte_api",
    "ZYTE_API",
    "api.zyte.com",
    ["API_KEY"]
  );
  const spmConfig = proxyConfig(
    "spm",
    "SPM",
    "indix.crawlera.com",
    ["SPM_API_KEY", "CRAWLERA_API_KEY"]
  );
  const csvContent = await readFile(INPUT_PATH, "utf8");
  const matchingRows = loadInputRows(csvContent);
  const rows = MAX_ROWS ? matchingRows.slice(0, MAX_ROWS) : matchingRows;

  if (rows.length === 0) {
    throw new Error(`No resolver=${FILTER_RESOLVER} URLs found in ${INPUT_PATH}`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const zyteApiClient = createProxyClient(zyteApiConfig);
  const spmClient = createProxyClient(spmConfig);
  const results: ComparisonResult[] = new Array(rows.length);
  const workerCount = Math.min(MAX_CONCURRENCY, rows.length);
  let nextIndex = 0;
  let completed = 0;
  const runStartedAt = performance.now();

  console.log(`Loaded ${rows.length} resolver=${FILTER_RESOLVER} URL(s) from ${INPUT_PATH}`);
  if (MAX_ROWS) {
    console.log(`Smoke-test row limit: ${MAX_ROWS} of ${matchingRows.length} matching row(s)`);
  }
  console.log(`Concurrency: ${workerCount} row(s), up to ${workerCount * 2} proxy requests`);
  console.log(`Zyte API proxy: ${zyteApiConfig.host}:${zyteApiConfig.port}`);
  console.log(`SPM proxy: ${spmConfig.host}:${spmConfig.port}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  const preflightUrl = rows[0].start_url.trim();
  console.log(`Running proxy credential preflight with: ${preflightUrl}`);
  const [zyteApiPreflight, spmPreflight] = await Promise.all([
    requestUrl(zyteApiClient, preflightUrl),
    requestUrl(spmClient, preflightUrl),
  ]);
  console.log(
    `Preflight statuses: Zyte API=${zyteApiPreflight.status ?? zyteApiPreflight.errorCode ?? "error"}, ` +
      `SPM=${spmPreflight.status ?? spmPreflight.errorCode ?? "error"}`
  );
  assertProxyAuthentication("Zyte API", zyteApiPreflight, [
    "ZYTE_API_PROXY_APIKEY",
    "API_KEY",
  ]);
  assertProxyAuthentication("SPM", spmPreflight, [
    "SPM_PROXY_APIKEY",
    "SPM_API_KEY",
    "CRAWLERA_API_KEY",
  ]);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++;
        if (index >= rows.length) return;

        const row = rows[index];
        const url = row.start_url.trim();
        const [zyteApi, spm] = await Promise.all([
          requestUrl(zyteApiClient, url),
          requestUrl(spmClient, url),
        ]);

        results[index] = {
          index,
          id: row.id,
          name: row.name,
          namespace: row.namespace,
          url,
          historicalProxyProvider: row.proxy_provider,
          expectedHttpStatus: row.http_status,
          zyteApi,
          spm,
        };

        completed += 1;
        if (completed % PROGRESS_INTERVAL === 0 || completed === rows.length) {
          const elapsedSeconds = (performance.now() - runStartedAt) / 1000;
          const rowsPerSecond = completed / elapsedSeconds;
          const remainingSeconds = (rows.length - completed) / rowsPerSecond;
          console.log(
            `Completed ${completed}/${rows.length} (${((completed / rows.length) * 100).toFixed(1)}%), ` +
              `${rowsPerSecond.toFixed(2)} rows/s, ETA ${Math.ceil(remainingSeconds)}s`
          );
        }
      }
    })
  );

  const comparisonCounts: Record<string, number> = {};
  for (const result of results) {
    const category = comparisonCategory(result);
    comparisonCounts[category] = (comparisonCounts[category] ?? 0) + 1;
  }

  const summary = {
    inputPath: INPUT_PATH,
    filterResolver: FILTER_RESOLVER,
    rows: results.length,
    matchingRows: matchingRows.length,
    maxRows: MAX_ROWS,
    uniqueUrls: new Set(results.map((result) => result.url)).size,
    concurrency: workerCount,
    maximumSimultaneousRequests: workerCount * 2,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    elapsedMs: Math.round(performance.now() - runStartedAt),
    zyteApi: summarizeProxy(results, "zyteApi"),
    spm: summarizeProxy(results, "spm"),
    comparisonCounts,
  };

  await Promise.all([
    writeFile(resolve(OUTPUT_DIR, "results.json"), `${JSON.stringify(results, null, 2)}\n`, "utf8"),
    writeFile(resolve(OUTPUT_DIR, "comparison.csv"), resultsCsv(results), "utf8"),
    writeFile(resolve(OUTPUT_DIR, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8"),
  ]);

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Finished. Results saved to ${OUTPUT_DIR}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
