import puppeteer, { Browser, Page } from "puppeteer-core";
import dotenv from "dotenv";
import _ from "lodash";
import path from "path";
import { performNavigationAction } from "./helpers";
import { delay } from "./utils";
import * as TW from "./types/tw";
import { WORDS } from "./terms";

dotenv.config();
if (!process.env.API_KEY) {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
if (!process.env.API_KEY) {
  throw new Error("Missing API_KEY in the local .env or the testbed root .env");
}

/** Returns true if the text only contains printable ASCII chars. */
function isAscii(text) {
  return /^[\x20-\x7F]*$/.test(text);
}

const WS_ENDPOINT =
  process.env.ZYTE_CDP_ENDPOINT || "wss://pop-us.browser.zyte.com/wss?ttl=600";

const proxy = {
  apiKey: process.env.API_KEY,
};

let scrapeMetrics = {
  total: 0,
  failures: 0,
  successes: 0,
  runtime: 0,
};

class TWScraper {
  // Time log
  timeLog = {
    patentSearchAndDetails: 0,
    scrapeTransactionStatus: 0,
    scrapeFiles: 0,
    total: 0,
    uploadFiles: 0,
  };

  // Tracks all html scrapings
  scrapings: TW.ScrapeState = {
    scraped_html_files: {},
    // Set `status` and `transaction` to null, so that we can override this with `unavailable` if either of
    // those pages are not accessible for the patent
    status: null,
    transaction: null,
    patent_information: "",
    case_information: "",
    case_file_list: "",
    file_list: "",
  };

  getTerms() {
    const min = 0;
    const max = WORDS.length;
    const random = () => Math.floor(Math.random() * (max - min) + min);
    const index = random();
    return `${WORDS[index]}`;
  }

  getDate = () => {
    const date = new Date();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const formatted = `${month}-${day}-${year}-${hours}${minutes}`;
    return formatted;
  };

  appNumber;

  async uploadXML() {
    console.log("Simulating xml upload...");
  }

  /**
   * Receives a string that may contain chinese characters. Replaces known phrases
   * using a translation table and returns the new string. If there are still chinese
   * characters after translating, log them for future reference.
   */
  translateText(text) {
    const phrases = [
      [/國際優先權證明文件/, "International priority document"],
      [/初審核准審定/, "Preliminary review and approval"],
      [/發文抄件/, "Transcript"],
      [/申復理由書/, "Reasons for application"],
      [/檢索報告/, "Search report"],
      [/外文本/, "Foreign language version"],
      [/修正說明書/, "Amendment manual"],
      [/無劃線替換頁/, "No underline replacement page"],
      [/部分劃線修正頁/, "Partial line correction page"],
      [/再審查理由書/, "Reasons for reexamination"],
      [/優先權證明文件裁切本/, "Cropped copy of priority document"],
      [
        /(Doc)?補充修正理由書/,
        "Amend the manual replacement page without underline",
      ],
      [/(Doc)?修正說明書無劃線替換頁/, "Supplementary amendment reason"],

      // Remove "[Doc]" from the start of the text
      [/^(\[Doc\])/, ""],

      // Remove "[1]", "[2]", etc. from the end of the text
      [/(\[\d\])$/, ""],
    ];

    for (let i = 0; i < phrases.length; i++) {
      const [regex, replacement] = phrases[i];
      text = text.replace(regex, replacement);
    }

    if (!isAscii(text)) {
      console.warn(`Text could not be fully translated "${text}"`);
    }

    return text;
  }

  async test() {
    const terms = this.getTerms();
    console.log(`search terms: ${terms}`);

    // Launch the browser
    const browser: Browser = await puppeteer.connect({
      browserWSEndpoint: WS_ENDPOINT,
      headers: {
        Authorization:
          "Basic " + Buffer.from(String(proxy.apiKey) + ":").toString("base64"),
      },
    });
    const tab: Page = await browser.newPage();
    try {
      // Set screen size.
      await tab.setViewport({ width: 1312, height: 1111 });

      // Get the `start` time
      const start = Date.now();

      // Set the default timeouts
      tab.setDefaultTimeout(10 * 1000);
      tab.setDefaultNavigationTimeout(60 * 1000);

      tab.on("load", () => console.log("navigated to", { url: tab.url() }));
      console.debug("Loading main patent page.");

      // Navigate to the main search page
      await performNavigationAction(
        tab,
        tab.goto("https://tiponet.tipo.gov.tw/twpat1/twpatc/twpatengkm")
      );

      // Wait for the nav to load
      try {
        await tab.waitForSelector("ul.L02", { timeout: 30000 });
      } catch (error) {
        console.error("Error loading patent search page.", {
          error,
        });
        const pageContent = await tab.content();
        console.debug("Page content", { content: pageContent });

        if (process.env.SCREENSHOTS) {
          await tab.screenshot({
            path: `./screenshots/patent-search-page-loading-error-${this.getDate()}.png`,
          });
        }
        throw new Error("Error loading patent search page.");
      }

      // enter search terms
      const searchTerms = terms;
      try {
        // Enter the patent number
        const searchInput = await tab.waitForSelector("input[name='_5_5_T']");
        await tab.evaluate(
          (element, appNum) => (element.value = appNum),
          searchInput,
          searchTerms
        );
      } catch (e) {
        console.error("Failed waiting for selector", {
          html: await tab.content(),
          url: tab.url(),
        });

        throw e;
      }

      // click search
      await performNavigationAction(
        tab,
        tab.evaluate(() => {
          const submit = document.querySelector(
            ".s_button > input:nth-child(1)"
          ) as HTMLElement;
          submit.click();
        }),
        ["domcontentloaded", "networkidle0"]
      );

      // Inspect the page to see what the result of our search was.
      // - If the patent doesn't exist, a message element appears saying No Result.
      // - Otherwise check the breadcrumb element. If it says "Result" we're on
      //     the search results page.
      // - If it says "Detail" we're on the patent detail page.
      const result: TW.PatentSearchResult = await tab.evaluate(
        (): TW.PatentSearchResult => {
          const msgBox = document.querySelector(
            ".lobibox-notify-msg"
          ) as HTMLElement;

          if (msgBox && msgBox.innerText.includes("No result")) {
            return "no-result";
          }

          const breadcrumb = document.querySelector("td.guide") as HTMLElement;
          const text = breadcrumb.innerText.trim();

          if (text === "Result") {
            return "results-page";
          } else if (text === "Detail") {
            return "detail-page";
          }

          return null;
        }
      );

      switch (result) {
        case "no-result":
          console.warn("Patent number not found.");
          await this.uploadXML();
          throw new Error("Patent number not found. Aborting.");
        case "results-page":
          // eslint-disable-next-line no-case-declarations
          const linkSelector = await tab.waitForSelector(
            "tr.sumtr1:nth-child(2) td.sumtd2_PN a.link02"
          );
          this.appNumber = await linkSelector.evaluate(
            (element) => element.innerText
          );
          // Select the most recent patent item and launch details
          await performNavigationAction(
            tab,
            tab.evaluate(() => {
              // eslint-disable-next-line no-undef
              const patentRows = document.querySelectorAll("tr.sumtr1");
              const rows = Array.from(patentRows);

              // Sort rows by the date (most recent first)
              const sortedRows = rows.sort((row1, row2) => {
                // Get row1 date
                const row1DateText =
                  row1.querySelector("td.sumtd2_ID").textContent;
                const row1DateSplit = row1DateText
                  .split("/")
                  .map((val) => parseInt(val));
                const row1Date = new Date(
                  Date.UTC(row1DateSplit[0], row1DateSplit[1], row1DateSplit[2])
                );

                // Get row2 date
                const row2DateText =
                  row2.querySelector("td.sumtd2_ID").textContent;
                const row2DateSplit = row2DateText
                  .split("/")
                  .map((val) => parseInt(val));
                const row2Date = new Date(
                  Date.UTC(row2DateSplit[0], row2DateSplit[1], row2DateSplit[2])
                );

                return row2Date.getUTCSeconds() - row1Date.getUTCSeconds();
              });

              // Get the first item
              const patentItem = sortedRows[0];
              const link = patentItem.querySelector(
                "td.sumtd2_PN a.link02"
              ) as HTMLElement;

              this.appNumber = link.innerText;

              // Click on the link to launch details
              link.click();
            }),
            ["domcontentloaded"]
          );
          break;
        case "detail-page":
          // Patent details are scraped below, nothing to do here
          break;
        default:
          console.error("Unknown page after doing patent search", {
            html: await tab.content(),
          });
          if (process.env.SCREENSHOTS) {
            await tab.screenshot({
              path: `./screenshots/unknown-page-error-${this.getDate()}.png`,
            });
          }
          throw new Error("Unknown page after doing patent search");
      }

      // get app number?
      console.log(this.appNumber);

      const content = await tab.content();

      // Scrape the patent information content
      const patentInformation = await tab.$eval(
        "td.Left_i",
        (e) => e.innerHTML
      );
      this.scrapings["patent_information"] = patentInformation;

      // Get the `end` time
      let end = Date.now();

      // Log the time it took for this section
      this.timeLog.patentSearchAndDetails = Math.floor((end - start) / 1000);

      console.debug("Scraped: Patent Information.");

      // Get the `start` time
      const transactionStatusStart = Date.now();

      /** Transaction Data */

      const transactionElement = await tab.evaluate(() => {
        const links = Array.from(
          document.querySelectorAll("td.tab62 ul li a")
        ) as HTMLAnchorElement[];

        // Get the link for `miscellaneous`
        const link = links.find(
          (link) => link.textContent === "Transaction Data"
        );

        if (link) {
          link.click();
          return true;
        }

        return false;
      });

      // Check if the transaction element is available
      if (transactionElement) {
        await tab.waitForNavigation();

        // Scrape the content
        const transactionContent = await tab.$eval(
          "table.disp62 td.info62",
          (e) => e.innerHTML
        );

        console.debug("Content scraped:", { content });

        // Add content to `scrapings` object
        this.scrapings.transaction = transactionContent;

        console.debug("Scraped: Transaction.");
      } else {
        console.debug("No transaction data available. Moving on.");
      }

      /** Status */

      // Select the `Status` link to launch the status details
      const statusElement = await tab.evaluate(() => {
        // eslint-disable-next-line no-undef
        const links = Array.from(
          document.querySelectorAll("td.tab62 ul li a")
        ) as HTMLAnchorElement[];

        // Get the link for `status`
        const link = links.find((link) => link.textContent === "Status");

        if (link) {
          link.click();
          return true;
        }

        return false;
      });

      // Check if the transaction element is available
      if (statusElement) {
        await tab.waitForNavigation();

        await tab.waitForSelector("table.disp62 td.status62", {
          timeout: 30000,
        });

        // Scrape the content
        const statusContent = await tab.$eval(
          "table.disp62 td.status62",
          (e) => e.innerHTML
        );

        console.debug("Content scraped.");

        // Add content to `scrapings` object
        this.scrapings.status = statusContent;

        console.debug("Scraped: Status.");
      } else {
        console.debug("No status data available. Moving on.");
      }

      // Get the `end` time
      const transactionStatusEnd = Date.now();

      // Log the time it took for this section
      this.timeLog.scrapeTransactionStatus = Math.floor(
        (transactionStatusEnd - transactionStatusStart) / 1000
      );

      /** Files */

      // Get the `start` time
      const filesStart = Date.now();

      console.debug("Loading patent file search page.");

      // Navigate to the file page - with the language english
      await performNavigationAction(
        tab,
        tab.goto("https://tiponet.tipo.gov.tw/S092_OUT/out?lang=en_US")
      );

      // Set up listener for dialogs.
      // If we fail the captcha unexpectedly, there will be a dialog displayed
      tab.on("dialog", async (dialog) => {
        console.warn("Error dialog displayed. Closing out.");

        await dialog.dismiss();
      });

      let caseInfo = false;
      try {
        // Scrape the html
        this.scrapings.case_information = await tab.$eval(
          ".rcontentBox",
          (e) => e.innerHTML
        );
        caseInfo = true;
        console.debug("Scraped: Case Information.");
      } catch (error) {
        console.warn(
          "Cannot find document information table. Captcha may have failed. Aborting."
        );
      }

      let caseFileDocumentList: TW.CaseFile[]; // default empty list

      if (caseInfo) {
        this.scrapings.case_file_list = await tab.evaluate(() => {
          const fileList = document.querySelector(".downloadBox");
          return fileList.innerHTML;
        });
        console.debug("Scraped: Case File List.");

        // Check to see if an error message is displayed
        let errorMessageDisplayed = null;
        try {
          await tab.waitForSelector(".loadingDiv");
          errorMessageDisplayed = await tab.$eval(
            ".loadingDiv",
            (e: HTMLElement) => e.innerText === "資料讀取錯誤"
          );
        } catch (error) {
          console.debug(
            "Error message might not be displayed, trying to scrape file list."
          );
        }

        // If the error message is displayed, log a warning and continue on
        if (errorMessageDisplayed) {
          console.warn("No files displayed, error message: `資料讀取錯誤`");
          throw new Error("File list unavailable, aborting.");
        }
        // Otherwise, scrape the file list normally
        else {
          // get the non-table container
          caseFileDocumentList = await tab.evaluate(() => {
            const caseFileTable = document.querySelector(".downloadBox");

            // get the non-table rows
            const rows = caseFileTable.querySelectorAll(".row");

            // Loop through rows pulling out the relevant information and assigning ids to document links
            const caseFiles = [];

            rows.forEach((row) => {
              // get the case file name
              const caseFileName =
                row.children[0].children[0].children[1].innerHTML;

              //   doc number
              const docNumber = row
                .querySelectorAll(".rcont_box")[0]
                .querySelectorAll("span")[1].innerText;
              //   date
              const docDate = row
                .querySelectorAll(".rcont_box")[1]
                .querySelectorAll("span")[1].innerText;

              const caseFile = {
                summary: caseFileName,
                docNumber: docNumber,
                docDate: docDate,
                documents: [],
              };
              //   file name
              const fileLinks = row.querySelectorAll("a");
              fileLinks.forEach((link) => {
                caseFile.documents.push({
                  url: link.getAttribute("data-url"),
                  caseReasonName: link.getAttribute("data-casereasonname"),
                  showName: link.getAttribute("data-showname"),
                  transName: "",
                });
              });
              caseFiles.push(caseFile);
            });

            return caseFiles;
          });

          // Translate document names
          for (const caseFile of caseFileDocumentList) {
            for (const document of caseFile.documents) {
              document.transName = this.translateText(document.showName);
            }
          }

          console.debug(`Checked for new files to upload.`);

          console.log("Simulating documents upload...");
        }
      }

      // Get the `end` time
      const filesEnd = Date.now();

      // Log the time it took for this section
      this.timeLog.scrapeFiles = Math.floor((filesEnd - filesStart) / 1000);

      // Get the `start` time
      const uploadStart = Date.now();

      console.debug("Combining scrapings...");

      console.debug("Processing full scrapings...");

      // Process data from `scrapings` to configure a single html string
      console.debug("Processing HTML data...");

      // Upload the scraped html and file list
      await this.uploadXML();

      // Get the `end` time
      const uploadEnd = Date.now();

      // Log the time it took for this section
      this.timeLog.uploadFiles = Math.floor((uploadEnd - uploadStart) / 1000);

      // Get the `end` time
      end = Date.now();

      // Log the time it took for this section
      this.timeLog.total = Math.floor((end - start) / 1000);

      console.log(`Time Log:`, this.timeLog);

      console.log("Scrape finished.");
      console.log("----------------------------------------------");

      scrapeMetrics = {
        ...scrapeMetrics,
        total: scrapeMetrics.total + 1,
        successes: scrapeMetrics.successes + 1,
        runtime: scrapeMetrics.runtime + this.timeLog.total,
      };

      console.log(scrapeMetrics);
      console.log("----------------------------------------------");
    } finally {
      await tab.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }
}

async function main() {
  await new TWScraper().test();
}

// Fire up the main function
(async () => {
  await main();
})();
