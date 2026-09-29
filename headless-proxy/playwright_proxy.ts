import "dotenv/config";
import { chromium } from "playwright";

const TARGET_URL = "https://www.capitalone.com/credit-cards/";
//const TARGET_URL = "https://www.walmart.com/ip/26-Ozark-Trail-M-3-Ranger-Electric-Fat-Tire-Bike-48V-Class-2-Black-Fits-Riders-5-2-6-1-Adult/8482660387";
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 20000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36";


async function main() {
    const browser = await chromium.launch({
      headless: false,
      proxy: {
        server: PROXY_SERVER,
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
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    userAgent: USER_AGENT,
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { timeout: 60000 });
  await page.waitForTimeout(WAIT_MS);
  // save html content to file for debugging
  const htmlContent = await page.content();
  const fs = require("fs");
  fs.writeFileSync("page_content.html", htmlContent);
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error("Playwright proxy script failed:", error);
  process.exit(1);
});
