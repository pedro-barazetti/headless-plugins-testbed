import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Builder } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";

const URLS_CSV_PATH = resolve(__dirname, "test-urls.csv");
const PROXY_SERVER = "http://localhost:3128";

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

async function main() {
  const csvContent = await readFile(URLS_CSV_PATH, "utf8");
  const urls = parseRequestedUrls(csvContent);

  if (urls.length === 0) {
    throw new Error(`No URLs found in CSV: ${URLS_CSV_PATH}`);
  }

  const options = new chrome.Options();
  options.addArguments(`--proxy-server=${PROXY_SERVER}`);
  options.addArguments("--window-size=1366,768");
  options.addArguments("--headless=new");
  options.setAcceptInsecureCerts(true);

  const driver = await new Builder().forBrowser("chrome").setChromeOptions(options).build();

  const failures: Array<{ url: string; error: unknown }> = [];

  try {
    for (const [index, url] of urls.entries()) {
      console.log(`[${index + 1}/${urls.length}] Visiting: ${url}`);

      try {
        await driver.get(url);
      } catch (error) {
        failures.push({ url, error });
        console.error(`[${index + 1}/${urls.length}] Failed: ${url}`);
        console.error(error);
      }
    }
  } finally {
    await driver.quit();
  }

  if (failures.length > 0) {
    throw new Error(`Finished with ${failures.length} failed URL(s).`);
  }

  console.log(`Finished successfully. Visited ${urls.length} URL(s).`);
}

main().catch((error) => {
  console.error("Selenium CSV proxy script failed:", error);
  process.exit(1);
});
