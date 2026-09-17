import puppeteer, { Browser, Page } from "puppeteer-core";
import axios, { AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";
import dotenv from "dotenv";
import _ from "lodash";
import fs from "fs";
import path from "path";
// import request from "request-promise-native";

import { performNavigationAction } from "./helpers";
import { delay } from "./utils";
import * as WO from "./types/wo";
import { assertResponseOK, RequestHandler, VerifyFunc } from "./request";
import { NUMBERS } from "./numbers";
dotenv.config();
if (!process.env.API_KEY) {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
if (!process.env.API_KEY) {
  throw new Error(
    "Missing API_KEY in wo-tester-cdp/.env or the testbed root .env"
  );
}

const FILE_PREFIX = "prosecution/WO-source/public";
const OPTIONS = [0, 1, 2, 3, 4, 5];
const WS_ENDPOINT =
  process.env.ZYTE_CDP_ENDPOINT || "wss://pop-us.browser.zyte.com/wss?ttl=600";

const proxy = {
  enable: false,
  apiKey: process.env.API_KEY,
};

let scrapeMetrics = {
  total: 0,
  failures: 0,
  successes: 0,
  runtime: 0,
};

class WOScraper {
  proxy = {
    // enable: false,
    protocol: "http",
    port: 8011,
    host: "api.zyte.com",
  };

  fileDownloadTimeout: number =
    parseInt(process.env.FILE_DOWNLOAD_TIMEOUT) || 30;

  downloadsDir = "./doc-downloads";

  patentNumber: string;

  // Time log
  timeLog: WO.TimeLog = {
    scrapeDetails: 0,
    scrapeDocuments: 0,
    scrapeFiles: 0,
    scrapeNationalPhases: 0,
    scrapeNotices: 0,
    total: 0,
    uploadFiles: 0,
  };

  // Tracks all html scrapings
  scrapings = {
    file_list: "",
    details: "",
    nationalPhases: "",
    notices: null,
  };

  // Tracks the xml download url
  xmlDownloadUrl: string;

  requestHandler = new RequestHandler();

  selectors = {
    content: {
      details: "div[id='detailMainForm:MyTabViewId:PCTBIBLIO']",
      // details: '//*[contains(concat(" ", normalize-space(@class), " "), " ps-biblio-data--biblio-card ")]',
      documents: ".patent-documents .ui-datatable",
      nationalPhase: "div[id='detailMainForm:MyTabViewId:NATIONALPHASE']",
      notices: "div[id='detailMainForm:MyTabViewId:NOTICES']",
    },
    tab: {
      details: "a[href='#detailMainForm:MyTabViewId:PCTBIBLIO']",
      documents: "a[href='#detailMainForm:MyTabViewId:PCTDOCUMENTS']",
      nationalPhase: "a[href='#detailMainForm:MyTabViewId:NATIONALPHASE']",
      notices: "a[href='#detailMainForm:MyTabViewId:NOTICES']",
    },
    /*
        search': {
            select: "select[id='simpleSearchForm:field:input']",
            input: "input[id='simpleSearchForm:fpSearch:input']",
            submit: "button[id^='simpleSearchForm:fpSearch']",
        },
	*/
    search: {
      input: "textarea[id='advancedSearchForm:advancedSearchInput:input']",
      submit: "button[id='advancedSearchForm:searchButton']",
    },
  };

  get requestSettings(): Partial<AxiosRequestConfig> {
    return {
      responseEncoding: "utf8",
      timeout: 300000,
      headers: {
        //"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
        //"Accept-Encoding": "gzip, deflate, br",
        //"Accept-Language": "en-US,en;q=0.9",
        //"Connection": "keep-alive",
        //"Pragma": "no-cache",
        //"Cache-Control": "no-cache",
        //"Cookie": _.map(this.cookieMain, cookie => `${cookie.name}=${cookie.value}`).join("; "),
        //"Host": "patentscope.wipo.int",
        //"Referer": this.urlMain,
        //"Sec-Fetch-Dest": "document",
        //"Sec-Fetch-Mode": "navigate",
        //"Sec-Fetch-Site": "same-origin",
        //"Sec-Fetch-User": "?1",
        //"Upgrade-Insecure-Requests": 1,
        //"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36",
        //"sec-ch-ua": '"Chromium";v="112", "Google Chrome";v="112", "Not:A-Brand";v="99"',
        //"sec-ch-ua-mobile": "?0",
        //"sec-ch-ua-platform": "Windows",
        // "x-crawlera-session": proxy.sessionId,
      },
    };
  }

  get proxySettings(): Partial<AxiosRequestConfig> {
    return {
      proxy: {
        protocol: this.proxy.protocol,
        host: this.proxy.host,
        port: this.proxy.port,
        auth: {
          username: proxy.apiKey,
          password: "",
        },
      },
    };
  }

  buildRequest(data: AxiosRequestConfig) {
    let payload = this.requestSettings;
    console.warn("payload", payload);

    if (proxy.enable) {
      payload = _.merge(payload, this.proxySettings);
    }

    payload = _.merge(payload, data);
    console.warn("payload 2", payload);

    return payload as AxiosRequestConfig;
  }

  /**
   * Makes a request and retries until it succeeds.
   */
  fetchWithRetry(data: AxiosRequestConfig, verifyFunc?: VerifyFunc) {
    const req = this.buildRequest(data);
    return this.requestHandler.getResponseWithRetry(req, verifyFunc);
  }

  /**
   * Uploads the specified `html` to a filepath utilizing the `patentNumber`
   * @param {string|buffer} data
   */
  async uploadHTML(data) {
    // Construct filepath
    const filepath = `${FILE_PREFIX}/xml/${this.patentNumber}.html`;

    // Upload data
    console.debug(
      `Simulating uploading data for ${this.patentNumber} at ${filepath}`
    );
  }

  /**
   * Take the application number and file and clean/convert to the fileName used on GCP
   *
   * Format: {appNo}-{file.fileDate}-{file.fileName}-{file.documentID || 'IASR'}.{extension}, e.g.
   *  WO2002IB002637-20081112-International_Application_Status_Report-IASR.pdf
   *
   * @param {object} document
   * @param {string} extension
   */
  getGCPFilename(document: WO.Document, extension: string) {
    let cleanAppNo = this.patentNumber;

    // If the first two characters are not `WO`, prefix string with `WO`
    if (cleanAppNo.substring(0, 2) !== "WO") {
      cleanAppNo = `WO${cleanAppNo}`;
    }

    // Clean the file name, and date
    // - Remove punctuation
    // - Replace spaces replace with underscores
    const cleanFilename = document.name
      .replace(/[.,/#!$%^&*;:{}=`~()[\]-_]/g, "")
      .replace(/ +/g, " ")
      .trim()
      .replace(/ /g, "_")
      .toLowerCase();

    return `${cleanAppNo}-${document.date}-${cleanFilename}.${extension}`;
  }

  convertFileListToHTML(documents: WO.Document[]) {
    let processedFileList = '<html><body><div title="uploaded-file-list">';

    documents.forEach((doc) => {
      // Process document if there is a `pdfUrl`
      if (doc.pdfUrl || doc.txtUrl) {
        processedFileList +=
          "<span " +
          `document_section="${doc.group}" ` +
          `status="${doc.status}" ` +
          `filepath="${this.getGCPFilename(
            doc,
            doc.pdfUrl ? "pdf" : "txt"
          )}" ` +
          `filename="${doc.name}" ` +
          `num_pages="${doc.numberOfPages ?? "unavailable"}" ` +
          `filedate="${doc.date}"></span>`;
      } else {
        console.warn("Document cannot be processed:", { document: doc });
      }
    });

    processedFileList += "</div></body></html>";
    return processedFileList;
  }

  /**
   * Combines all objects within the keys of `data`.
   * - Converts html to string
   * - Removes unneeded data
   * @param {object} data
   * @param {boolean} includeVersion
   * @returns processed html string
   */
  combineAndProcessHtml(data) {
    console.debug("Processing HTML data...");

    // Combine data
    const processed: string[] = [];

    // Add scraper version
    processed.push(`<!!!--SCRAPER_VERSION--!!!>`);
    processed.push(`<span version="1234"></span>`);
    processed.push(`</!!!--SCRAPER_VERSION--!!!>`);

    // Add data
    const keys = Object.keys(data);
    keys.forEach((key) => {
      // const value = data[key];

      // Push this tab's data onto our main html array, surrounded by tags
      processed.push(`<!!!--${key}--!!!>`);
      processed.push(data[key] || "unavailable");
      processed.push(`</!!!--${key}--!!!>`);
    });

    // Process data, removing unneeded parts
    const result = `\n${processed.join("")}`
      .replace(/\r?\n|\r|\t/g, "")
      .replace(/<script.*?<\/script>/g, "")
      .replace(/<noscript.*?<\/noscript>/g, "")
      .replace(/<!-- footer.jsp -->.*?<\/!!!--/g, "</!!!--")
      .replace(/>\s*\n\s*</g, ">\n<")
      .replace(/[\n\r]<\//g, "</");

    return result;
  }

  /**
   * Check to see if the file with `filename` exists, if not delay 5 seconds and check again.
   * - Continue waiting until the file exists (and therefore has been downloaded completely).
   * - Times out at 30 seconds by default.
   * @param {string} filename
   */
  async waitForFileToDownload(filename, fileDownloadWait = 0) {
    if (
      !fs.existsSync(filename) &&
      (!fileDownloadWait || fileDownloadWait < this.fileDownloadTimeout)
    ) {
      console.debug(
        `File ${filename} does not exist yet, it probably hasn't finished downloading. Delaying for 5 seconds (${
          fileDownloadWait || 0
        } seconds waited).`
      );
      await delay(5);
      fileDownloadWait += 5;
      return await this.waitForFileToDownload(filename, fileDownloadWait);
    } else {
      return true;
    }
  }

  /**
   * Scrapes the document page for all the document metadata
   */
  async getDocumentMetadata(tab: Page) {
    const documents = await tab.$$eval(
      this.selectors.content.documents,
      ($tables: HTMLDivElement[]) => {
        const documents: WO.Document[] = [];

        $tables.forEach(($table) => {
          // The heading for the table describes what kind of documents these are
          const group = (
            $table.querySelector(".ui-datatable-header") as HTMLElement
          ).innerText;
          const $rows = Array.from(
            $table.querySelectorAll("tbody tr")
          ) as HTMLTableRowElement[];

          $rows.forEach(($row) => {
            /*
                        Each row has 4 cells:

                        - Date
                        - Title
                        - Viewable documents
                        - Direct download documents
                    */
            const $cells = Array.from(
              $row.querySelectorAll("td")
            ) as HTMLTableCellElement[];

            // Date is formatted as DD.MM.YYYY, convert to YYYYMMDD
            const dateParts = $cells[0].innerText.split(".");
            const date = `${dateParts[2]}${dateParts[1]}${dateParts[0]}`;

            const name = $cells[1].innerText;

            const scrapeDocURLs = ($el: HTMLElement): WO.DocumentURL => {
              const $a = $el.querySelector("a") as HTMLAnchorElement;
              const href = $a.href;
              const docType = $a.innerText;
              let pageCount: number;

              // PDFs have a page count in the form `<number> p.`
              if (docType === "PDF") {
                pageCount = parseInt(
                  $el.querySelector("small").innerText.split(" ")[0]
                );
              }

              const url = new URL(href);
              let docId: string;

              if (url.searchParams.has("docId")) {
                const val = url.searchParams.get("docId");

                if (val.startsWith("id")) {
                  docId = val.substr(2);
                }
              }

              return {
                docId,
                pageCount,
                type: docType,
                url: href,
              };
            };

            // Documents which are viewable in the browser
            const $viewableDocs = Array.from(
              $cells[2].querySelectorAll("span.ps-downloadables")
            ) as HTMLElement[];

            // Documents which have a direct download link
            const $directDocs = Array.from(
              $cells[3].querySelectorAll("span.ps-downloadables")
            ) as HTMLElement[];

            // There doesn't seem to be any difference between viewable and direct
            // download docs, other than the viewable ones open in a browser tab
            // and the direct download ones open the save file dialog. However,
            // we prefer the direct docs since there is a docId in the URL
            const viewables = $viewableDocs.map(($doc) => scrapeDocURLs($doc));
            const directs = $directDocs.map(($doc) => scrapeDocURLs($doc));

            // Start with all the direct doc URLs
            const urls: WO.DocumentURL[] = [...directs];

            // Check each viewable and add it to the list of URLs if the document
            // type doesn't exist as a direct download. This prioritizes the direct
            // download docs and uses the viewable ones as a fallback
            viewables.forEach((viewable) => {
              // urls.push(viewable);
              if (!directs.find((direct) => direct.type === viewable.type)) {
                urls.push(viewable);
              }
            });

            const doc: WO.Document = {
              date,
              group,
              name,
              numberOfPages: urls
                .find((url) => url.pageCount)
                ?.pageCount.toString(),
              urls,
            };

            doc.pdfUrl = urls.find((url) => url.type === "PDF")?.url;
            doc.txtUrl = urls.find((url) => url.type === "TXT")?.url;
            doc.docId = urls.find((url) => url.docId)?.docId;

            documents.push(doc);
          });
        });

        return documents;
      },
      this.selectors
    );

    const IASP = documents.find(
      (doc) => doc.name === "International Application Status Report"
    );

    if (IASP) {
      this.xmlDownloadUrl = IASP.urls.find((url) => url.type === "XML")?.url;
    }

    if (!this.xmlDownloadUrl) {
      // console.warn("Unable to get XML document for IASP", { urls: IASP.urls });
      console.warn("Unable to get XML document for IASP");
    }

    return documents;
  }

  /**
   * Fetches a document and returns its contents as a Buffer
   */
  async fetchDocument(document: WO.Document) {
    console.debug(`Fetching document "${document.name}"...`);

    const url = document.pdfUrl || document.txtUrl;
    const resp = await this.fetchWithRetry({ url }, async (resp) => {
      assertResponseOK(resp);
    });

    return resp.data as Buffer;
  }

  async createDownloadsDir() {
    if (!fs.existsSync(this.downloadsDir)) {
      fs.mkdirSync(this.downloadsDir);
    }
  }

  async fetchAndUploadDocument(document: WO.Document) {
    try {
      const data = await this.fetchDocument(document);
      const filePath = `${FILE_PREFIX}/unprocessed/${this.patentNumber}/${document.fileName}`;

      console.info(`Simluating uploading ${filePath}`);
    } catch (e) {
      console.warn("Error downloading file.", { e, document });
      document.status = "download-failed";
    }
  }

  async fetchAndUploadXML(tab) {
    if (!this.xmlDownloadUrl) {
      // return;

      const data =
        "<wo-international-application-status></wo-international-application-status>";
      const filePath = `${FILE_PREFIX}/xml/${this.patentNumber}.xml`;
      console.info(`Simulating uploading ${filePath}`);
      return;
    }

    try {
      // const resp = await this.fetchWithRetry({ url: this.xmlDownloadUrl, encoding: null });

      // open new tab
      const browser = tab.browser();
      const newTab = await browser.newPage();

      // get xml url
      const url = this.xmlDownloadUrl;
      const tempUrl = new URL(url);
      const urlParams = new URLSearchParams(tempUrl.search);
      const pathParts = url.split("/");
      const tempFileName = pathParts[pathParts.length - 1];

      // if url contains filename param grab that
      // otherwise use the alphanumeric name from the end of the url
      const downloadedFileName =
        urlParams.get("filename") || `${tempFileName}.xml`;
      const downloadedFilePath = `${this.downloadsDir}/${downloadedFileName}`;

      // Set the download behavior so we can download the file locally
      const client = await tab.target().createCDPSession();
      await client.send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: this.downloadsDir,
      });

      try {
        await newTab.goto(this.xmlDownloadUrl);
      } catch (e) {
        console.warn("Potential error downloading file", e);
      }

      // wait for file to download
      await this.waitForFileToDownload(downloadedFilePath);

      // const resp = await newTab.goto(this.xmlDownloadUrl);
      // const data = await resp.buffer();
      const filePath = `${FILE_PREFIX}/xml/${this.patentNumber}.xml`;

      // upload downloaded file
      console.info(`Simulating uploading ${filePath}`);

      // await asyncPipeline(Readable.from(data), uploadStream(filePath));
      fs.unlinkSync(downloadedFilePath);
      await newTab.close();
    } catch (e) {
      console.warn("Error downloading file.", { e });
    }
  }

  generateNumber = () => {
    const current = new Date();
    const index = +current % OPTIONS.length;

    console.log("Using option index:", { index });

    return OPTIONS[index];
  };

  async isTabEnabled(tab: Page, selector: string) {
    let disabled;
    try {
      disabled = await tab.$eval(selector, (e: HTMLElement) =>
        e.parentElement.className.includes("ui-state-disabled")
      );
    } catch (e) {
      console.log("can't find element");
    }

    return !disabled;
  }

  /**
   * Navigates to the patent detail page by searching for the app number
   */
  async gotoPatentPage(tab: Page, appNumber: string) {
    console.debug("Navigating to search page...");

    await performNavigationAction(
      tab,
      /// tab.goto("https://patentscope.wipo.int/search/en/search.jsf")
      tab.goto("https://patentscope.wipo.int/search/en/advancedSearch.jsf")
    );

    console.debug(`Searching ${appNumber}...`);

    // Select the ID/Number field
    // await tab.select(this.selectors.search.select, "ALLNUM");

    // Set the search input value
    await tab.$eval(
      this.selectors.search.input,
      (e: HTMLInputElement, val: string) => {
        e.value = val;
      },
      "AN:" + appNumber
    );

    console.debug("Submitting search...");

    await performNavigationAction(
      tab,
      tab.click(this.selectors.search.submit),
      ["domcontentloaded", "networkidle0"]
    );
    console.log("Navigation action finished.");

    const unavailable = (await tab.content()).includes("No results were found");

    if (unavailable) {
      // throw new PatentNotAvailable("No search results were found");
      const html = this.combineAndProcessHtml({ error: "unavailable" });
      this.uploadHTML(html);
    }

    return unavailable;
  }

  getPatentNumber = () => {
    const min = 0;
    const max = NUMBERS.length;
    const random = () => Math.floor(Math.random() * (max - min) + min);
    const index = random();
    const patentNumber = NUMBERS[index].replace("JP,", "");
    return `${patentNumber}`;
  };

  /**
   * Main scrape function.
   */
  async test() {
    // Connect to a browser running remotely on Zyte CDP.
    const browser: Browser = await puppeteer.connect({
      browserWSEndpoint: WS_ENDPOINT,
      headers: {
        Authorization:
          "Basic " + Buffer.from(String(proxy.apiKey) + ":").toString("base64"),
      },
    });
    const tab: Page = await browser.newPage();
    try {
      // Get the `start` time
      const start = Date.now();

      this.patentNumber = this.getPatentNumber();

      // Set the default timeouts
      tab.setDefaultTimeout(15000);
      tab.setDefaultNavigationTimeout(300000);

      console.debug("Searching for patent...");

      const unavailable = await this.gotoPatentPage(tab, this.patentNumber);

      if (unavailable) {
        return;
      }

      // Check if the Details tab is present and clickable
      let hasDetails = false;

      try {
        await tab.waitForSelector(this.selectors.tab.details);
        hasDetails = await this.isTabEnabled(tab, this.selectors.tab.details);
      } catch (e) {
        console.log("There's no details tab. Skip it.");
      }

      console.log(`details? ${hasDetails}`);

      // Scrape Details
      if (hasDetails) {
        await tab.click(this.selectors.tab.details);
        await tab.waitForSelector(this.selectors.content.details);

        // sleep
        const date = Date.now();
        let currentDate = null;
        do {
          currentDate = Date.now();
        } while (currentDate - date < 5000);

        const content = await tab.$eval(
          this.selectors.content.details,
          (e) => e.innerHTML
        );
        this.scrapings.details = content;

        console.debug("Scraped Details, moving onto National Phases.");
      } else {
        console.debug("No Details, moving onto National Phases.");
      }

      // Log the time it took for this section
      this.timeLog.scrapeDetails = Math.floor((Date.now() - start) / 1000);

      // Get the `start` time
      const startNationalPhases = Date.now();

      // Check if the National Phase tab is clickable
      let hasNationalPhases = false;

      try {
        await tab.waitForSelector(this.selectors.tab.nationalPhase);
        hasNationalPhases = await this.isTabEnabled(
          tab,
          this.selectors.tab.nationalPhase
        );
      } catch (e) {
        console.log("can't find. skip.");
      }

      // Move onto national phases if the patent has them
      if (hasNationalPhases) {
        await tab.click(this.selectors.tab.nationalPhase);
        await tab.waitForSelector(this.selectors.content.nationalPhase);

        // sleep
        const date = Date.now();
        let currentDate = null;
        do {
          currentDate = Date.now();
        } while (currentDate - date < 5000);

        const content = await tab.$eval(
          this.selectors.content.nationalPhase,
          (e) => e.innerHTML
        );
        this.scrapings.nationalPhases = content;

        console.debug("Scraped National Phases, moving onto Notices.");
      } else {
        console.debug("No national phases. Moving onto Notices.");
      }

      // Log the time it took for this section
      this.timeLog.scrapeNationalPhases = Math.floor(
        (Date.now() - startNationalPhases) / 1000
      );

      // Get the `start` time
      const startNotices = Date.now();

      let hasNotices = false;

      try {
        await tab.waitForSelector(this.selectors.tab.notices);
        hasNotices = await this.isTabEnabled(tab, this.selectors.tab.notices);
      } catch (e) {
        console.log("no tab. skip.");
      }

      // Move onto notices if the patent has them
      if (hasNotices) {
        await tab.click(this.selectors.tab.notices);
        await tab.waitForSelector(this.selectors.content.notices);

        // sleep
        const date = Date.now();
        let currentDate = null;
        do {
          currentDate = Date.now();
        } while (currentDate - date < 5000);

        const content = await tab.$eval(
          this.selectors.content.notices,
          (e) => e.innerHTML
        );
        this.scrapings.notices = content;

        console.debug("Scraped Notices, moving onto documents.");
      } else {
        console.debug("No Notices. Moving onto documents.");
      }

      // Log the time it took for this section
      this.timeLog.scrapeNotices = Math.floor(
        (Date.now() - startNotices) / 1000
      );

      // Get the `start` time
      const startDocuments = Date.now();

      let documents;

      try {
        await tab.click(this.selectors.tab.documents);
        await tab.waitForSelector(this.selectors.content.documents);
      } catch (e) {
        console.log("can't find doc's");
        documents = false;
      }

      if (documents) {
        documents = await this.getDocumentMetadata(tab);
        console.debug("Found documents:", documents);
      }

      this.timeLog.scrapeDocuments = Math.floor(
        (Date.now() - startDocuments) / 1000
      );

      const startUploading = Date.now();

      console.warn("fetch documents");

      await this.createDownloadsDir();

      if (documents) {
        documents.forEach(async (doc) => {
          console.warn(doc);
          // await this.openAndUploadDocument(doc, tab);
        });
      }

      console.warn("fetch xml");

      await this.fetchAndUploadXML(tab);

      // Add the scraped file list
      if (documents) {
        this.scrapings.file_list = this.convertFileListToHTML(documents);
      }

      // Log the time it took for this section
      this.timeLog.uploadFiles = Math.floor(
        (Date.now() - startUploading) / 1000
      );

      const html = this.combineAndProcessHtml(this.scrapings);

      this.uploadHTML(html);

      // Log the time it took for this section
      this.timeLog.total = Math.floor((Date.now() - start) / 1000);

      console.log(`(${this.patentNumber}) Time Log:`, this.timeLog);

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
  await new WOScraper().test();
}

// Fire up the main function
(async () => {
  await main();
})();
