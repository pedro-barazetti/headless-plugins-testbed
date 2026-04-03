import "dotenv/config";
import { Builder } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";

const TARGET_URL =  "https://codelibrary.amlegal.com/codes/mtpleasanttx/latest/mtpleasant_tx/0-0-0-21116";
//const TARGET_URL =  "https://books.toscrape.com/";
const PROXY_SERVER = "http://localhost:3128";
const WAIT_MS = 5000;

async function main() {
  const options = new chrome.Options();
  options.addArguments(`--proxy-server=${PROXY_SERVER}`);
  options.addArguments("--window-size=1366,768");
  options.setAcceptInsecureCerts(true);

  const driver = await new Builder()
    .forBrowser("chrome")
    .setChromeOptions(options)
    .build();

  try {
    await driver.get(TARGET_URL);
    await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
  } finally {
    await driver.quit();
  }
}

main().catch((error) => {
  console.error("Selenium proxy script failed:", error);
  process.exit(1);
});
