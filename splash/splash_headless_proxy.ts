import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULT_TARGET_URL =
  "https://caselook.clevelandheightscourt.com/disclaimer/1823";
const SPLASH_URL = process.env.SPLASH_HEADLESS_PROXY_URL ?? "http://localhost:8052";
const SPLASH_PROXY_PROFILE = "headless-proxy";
const TARGET_URL = process.env.TARGET_URL ?? DEFAULT_TARGET_URL;
const OUTPUT_DIR = resolve(
  process.cwd(),
  process.env.SPLASH_HEADLESS_PROXY_OUTPUT_DIR ?? "output/splash-headless-proxy",
);

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

const WAIT_SECONDS = readPositiveNumber("SPLASH_WAIT_SECONDS", 5);
const TIMEOUT_SECONDS = readPositiveNumber("SPLASH_TIMEOUT_SECONDS", 90);

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

async function main(): Promise<void> {
  if (WAIT_SECONDS >= TIMEOUT_SECONDS) {
    throw new Error("SPLASH_WAIT_SECONDS must be less than SPLASH_TIMEOUT_SECONDS");
  }

  const splashEndpoint = new URL("/render.json", SPLASH_URL);
  const requestBody = {
    url: TARGET_URL,
    proxy: SPLASH_PROXY_PROFILE,
    wait: WAIT_SECONDS,
    timeout: TIMEOUT_SECONDS,
    resource_timeout: Math.min(45, TIMEOUT_SECONDS * 0.8),
    viewport: "1366x768",
    render_all: 1,
    html: 1,
    png: 1,
    history: 1,
  };

  console.log(`Splash endpoint: ${splashEndpoint.toString()}`);
  console.log(`Splash proxy profile: ${SPLASH_PROXY_PROFILE}`);
  console.log("Proxy chain: Splash -> zyte-smartproxy-headless-proxy -> Crawlera");
  console.log(`Target URL: ${TARGET_URL}`);

  let response: Response;
  try {
    response = await fetch(splashEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout((TIMEOUT_SECONDS + 15) * 1000),
    });
  } catch (error: unknown) {
    const cause =
      error instanceof Error && "cause" in error
        ? (error.cause as { code?: string } | undefined)
        : undefined;

    if (cause?.code === "ECONNREFUSED") {
      throw new Error(
        `Cannot connect to Splash at ${splashEndpoint.origin}. Start the stack with "npm run splash-headless-proxy-start", then retry.`,
      );
    }

    throw error;
  }

  if (!response.ok) {
    const details = (await response.text()).slice(0, 2_000);
    throw new Error(
      `Splash returned HTTP ${response.status} ${response.statusText}: ${details}`,
    );
  }

  const result = (await response.json()) as SplashResult;
  const targetStatus = getMainDocumentStatus(result.history);
  const fileStem = safeFileStem(TARGET_URL);

  await mkdir(OUTPUT_DIR, { recursive: true });

  if (result.html !== undefined) {
    await writeFile(resolve(OUTPUT_DIR, `${fileStem}.html`), result.html, "utf8");
  }

  if (result.png !== undefined) {
    await writeFile(resolve(OUTPUT_DIR, `${fileStem}.png`), result.png, "base64");
  }

  const metadata = {
    proxyChain: "Splash -> zyte-smartproxy-headless-proxy -> Crawlera",
    requestedUrl: result.requestedUrl,
    finalUrl: result.url,
    title: result.title,
    targetStatus,
    geometry: result.geometry,
    historyEntryCount: result.history?.length ?? 0,
  };
  await writeFile(
    resolve(OUTPUT_DIR, `${fileStem}.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );

  console.log(`Target HTTP status: ${targetStatus ?? "not reported"}`);
  console.log(`Final URL: ${result.url ?? "not reported"}`);
  console.log(`Page title: ${result.title ?? "not reported"}`);
  console.log(`Rendered HTML bytes: ${Buffer.byteLength(result.html ?? "", "utf8")}`);
  console.log(`Artifacts: ${OUTPUT_DIR}`);

  if (!result.html) {
    throw new Error("Splash returned no rendered HTML");
  }

  if (targetStatus !== undefined && targetStatus >= 400) {
    throw new Error(`Target navigation failed with HTTP ${targetStatus}`);
  }
}

main().catch((error: unknown) => {
  console.error("Splash headless-proxy test failed:", error);
  process.exit(1);
});
