import "dotenv/config";
import puppeteer from "puppeteer";

const TARGET_URLS = [
  "https://eservices.fairfieldcountycpcourt.org/eservices/home.page.7",
  "https://courtvweb.allencountyohio.com/eservices/home.page.2",
];
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 15000;

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    devtools: false,
    defaultViewport: { width: 1366, height: 768 },
    args: [
      `--proxy-server=${PROXY_SERVER}`,
      "--window-size=1366,768",
      "--ignore-certificate-errors",
    ],
  });

  try {
    const page = await browser.newPage();

    for (const targetUrl of TARGET_URLS) {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 120000,
      });
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error("Puppeteer proxy script failed:", error);
  process.exit(1);
});