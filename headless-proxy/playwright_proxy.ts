import "dotenv/config";
import { chromium } from "playwright";

//const TARGET_URL = "http://sfgate.com/news/bayarea/article/napa-co-expansion-of-american-canyon-city-limit-22303964.php";
const TARGET_URL = "https://www.walmart.com/ip/26-Ozark-Trail-M-3-Ranger-Electric-Fat-Tire-Bike-48V-Class-2-Black-Fits-Riders-5-2-6-1-Adult/8482660387";
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 45000;

async function main() {
  const browser = await chromium.launch({
    headless: false,
    devtools: false,
    proxy: {
      server: PROXY_SERVER,
    },
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 },
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
