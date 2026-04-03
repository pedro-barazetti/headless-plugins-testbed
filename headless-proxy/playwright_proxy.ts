import "dotenv/config";
import { chromium } from "playwright";

const TARGET_URL = "https://eservices.fairfieldcountycpcourt.org/eservices/home.page.7";
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 15000;

async function main() {
  const browser = await chromium.launch({
    headless: false,
    devtools: true,
    proxy: {
      server: PROXY_SERVER,
    },
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto(TARGET_URL);
  await page.waitForTimeout(WAIT_MS);
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error("Playwright proxy script failed:", error);
  process.exit(1);
});
