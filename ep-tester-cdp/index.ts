import puppeteer, { Browser, Page } from "puppeteer-core";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import dotenv from "dotenv";
import _ from "lodash";
import path from "path";
import moment from "moment";
// import request from "request-promise-native";

import * as EP from "./types/ep";
import {
  assertMimeType,
  assertResponseOK,
  RequestHandler,
  VerifyFunc,
} from "./request";
import JSZip from "jszip";
import { NUMBERS } from "./numbers";
dotenv.config();
if (!process.env.API_KEY) {
  dotenv.config({ path: path.join(__dirname, "..", ".env") });
}
if (!process.env.API_KEY) {
  throw new Error("Missing API_KEY in the local .env or the testbed root .env");
}

const FILE_PREFIX = "prosecution/EP-source/public";
const WS_ENDPOINT =
  process.env.ZYTE_CDP_ENDPOINT || "wss://pop-us.browser.zyte.com/wss?ttl=600";

const proxy = {
  // enable: false,
  apiKey: process.env.API_KEY,
};

let scrapeMetrics = {
  total: 0,
  failures: 0,
  successes: 0,
  runtime: 0,
};

class EPScraper {
  proxy = {
    enable: false,
    protocol: "http",
    port: 8011,
    host: "api.zyte.com",
  };

  // Time log
  timeLog: EP.TimeLog = {
    scrapeDetails: 0,
    scrapeAndUploadFiles: 0,
    scrapeJson: 0,
    total: 0,
  };

  patentNumber: string;

  // Tracks all html scrapings
  scrapings = {
    file_list: "",
  };

  documentListResults: EP.DocumentListResults;

  requestHandler = new RequestHandler();

  get requestSettings(): Partial<AxiosRequestConfig> {
    return {
      responseEncoding: "utf8",
      timeout: 300000,
      headers: {
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
        "Accept-Language": "en-US,en;q=0.9",
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

    if (this.proxy.enable) {
      payload = _.merge(payload, this.proxySettings);
    }

    payload = _.merge(payload, data);

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
   * Like fetchWithRetry, but also checks to see if the response includes
   * an IP banned message. `tab` will have its content set to the response body,
   * if the response is HTML.
   */
  fetchWithErrorHandling(tab: Page, data: AxiosRequestConfig) {
    const callback = async (resp: AxiosResponse) => {
      assertMimeType(resp, "text/html");

      await tab.setContent(resp.data);
      const banned = await this.checkIfBanned(tab);

      if (banned) {
        throw Error("IP banned");
      }
    };

    return this.fetchWithRetry(data, callback);
  }

  /**
   * Uploads the specified `json` to a filepath utilizing the `patentNumber`
   * @param {string|buffer} data
   */
  async uploadScrapedJsonData(data) {
    // Construct filepath
    const filepath = `${FILE_PREFIX}/json/${this.patentNumber}.json`;

    console.debug(
      `Simulating uploading data for ${this.patentNumber} at ${filepath}`
    );
  }

  /**
   * Uploads the specified `html` to a filepath utilizing the `patentNumber`
   * @param {string|buffer} data
   */
  async uploadScrapedHtmlData(data) {
    // Construct filepath
    const filepath = `${FILE_PREFIX}/xml/${this.patentNumber}.html`;

    console.debug(
      `Simulating uploading data for ${this.patentNumber} at ${filepath}`
    );
  }

  /**
   * Take the application number and file and clean/convert to the fileName used on GCP
   *
   * Format: {appNo}-{file.fileDate}-{file.fileName}-{file.documentID}.pdf, e.g.
   *   EP00931398-20030219-bibliographic_data_of_the_european_patent_application-EFQ0VQ7RJT21459.pdf.pdf
   *
   * @param {object} document
   */
  getGCPFilename(document) {
    let cleanAppNo = this.patentNumber;
    // If the first two characters are not `EP`, prefix string with `EP` unless it begins with `WO`
    if (
      cleanAppNo.substring(0, 2) !== "EP" &&
      cleanAppNo.substring(0, 2) !== "WO"
    ) {
      cleanAppNo = `EP${cleanAppNo}`;
    }

    // Clean the file name, and date
    // - Remove punctuation
    // - Replace spaces replace with underscores
    const cleanFilename = document.name
      .replace(/ /g, "_")
      .replace(/[.,/#!$%^&*;:{}=`~()[\]-]/g, "");
    const cleanDate = moment(document.date, "DD.MM.YYYY").format("YYYYMMDD");

    return `${cleanAppNo}-${cleanDate}-${document.id}-${cleanFilename}.pdf`;
  }

  /**
   * Take the application number and scraped file list and convert it into HTML
   * @param {string} appNo
   */
  convertFileListToHTML() {
    let html = '<html><body><div title="uploaded-file-list">';
    const { documents, error } = this.documentListResults;

    if (error) {
      html += error;
    } else {
      documents.forEach((doc) => {
        html +=
          "<span " +
          `document_section="${doc.type}" ` +
          `status="${doc.status}" ` +
          `filepath="${doc.filepath}" ` +
          `filename="${doc.name}" ` +
          `docId="${doc.id}" ` +
          `num_pages="${doc.numberOfPages}" ` +
          `filedate="${moment(doc.date, "DD.MM.YYYY").format(
            "YYYYMMDD"
          )}"></span>`;
      });
    }

    html += "</div></body></html>";
    return html;
  }

  /**
   * Combines all objects within the keys of `data`.
   * - Converts html to string
   * - Removes unneeded data
   * @param {object} data
   * @param {boolean} includeVersion
   * @returns processed html string
   */
  combineAndProcessHtml(data: object) {
    console.debug("Processing HTML data...");

    // Combine data
    const processed: string[] = [];

    // Add scraper version
    processed.push(`<!!!--SCRAPER_VERSION--!!!>`);
    processed.push(`<span version="123"></span>`);
    processed.push(`</!!!--SCRAPER_VERSION--!!!>`);

    // Add data
    const keys = Object.keys(data);
    keys.forEach((key) => {
      const value = data[key];

      // Push this tab's data onto our main html array, surrounded by tags
      processed.push(`<!!!--${key}--!!!>`);
      processed.push(value || "unavailable");
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
   * Checks if the ban error is displayed
   * @param {object} tab
   * @returns {bool}
   */
  async checkIfBanned(tab) {
    return await tab.$eval(
      "html",
      (e) =>
        e.innerText.includes("The IP address has been blacklisted") ||
        e.innerText.includes(
          "Some of the requests from this IP are seen as originating from automated tools"
        ) ||
        e.innerText.includes(
          "European Patent Register has rejected your request"
        ) ||
        e.innerText.includes("Rate limit quota violation")
    );
  }

  /**
   * Scrapes the doclist page for metadata on all the documents for a given patent.
   */
  async getDocumentMetadata(tab: Page, patent: string) {
    const url = `https://register.epo.org/application?lng=en&tab=doclist&number=${patent}`;

    console.debug("Fetching doclist...");

    await this.fetchWithErrorHandling(tab, { url });

    const results = await tab.evaluate((appNo) => {
      const results: EP.DocumentListResults = {
        documents: [],
        error: null,
      };

      const heading = document.querySelector(
        "#body > h3"
      ) as HTMLElement | null;

      if (heading) {
        if (heading.innerText.includes("File unavailable")) {
          results.error = "unavailable";
        } else if (heading.innerText.includes("File destroyed")) {
          results.error = "destroyed";
        }
      }

      if (results.error) {
        return results;
      }

      const table = document.querySelector(
        'table[id="row"]'
      ) as HTMLTableElement | null;

      if (!table) {
        results.error = "table-missing";
        return results;
      }

      const rows = Array.from(
        document.querySelectorAll("tbody tr")
      ) as HTMLTableRowElement[];

      rows.forEach((row) => {
        // Pull out document name, date and type
        const cells = Array.from(row.querySelectorAll("td"));

        // Skip the first cell
        cells.splice(0, 1);

        const id = (cells[1].firstChild as HTMLElement).id;
        const href = (cells[1].firstChild as HTMLAnchorElement).href;

        // Extract the app number from the href (in case it's different from the patent number)
        const hrefParts = href.split("'");
        const number = hrefParts[1].split("&")[1].split("=")[1];

        const document: EP.Document = {
          date: cells[0].innerText,
          name: cells[1].innerText,
          id,
          type: cells[2].innerText,
          numberOfPages: cells[3].innerText,
          url: `https://register.epo.org/application?showPdfPage=all&documentId=${id}&appnumber=${number}&proc=`,
          zipFile: null,
        };

        results.documents.push(document);
      });

      return results;
    }, this.patentNumber);

    if (results.error) {
      console.warn(`Document list is missing, reason: ${results.error}`);
    } else {
      console.debug(`Found ${results.documents.length} documents.`);
    }

    return results;
  }

  /**
   * Fetch the zip archive for the documents.
   */
  async getDocumentZip(patent: string) {
    console.debug("Fetching document zip...");

    const url = `https://register.epo.org/download?number=${patent}&output=zip`;
    const resp = await this.fetchWithRetry(
      { url, responseEncoding: null },
      async (resp) => {
        assertResponseOK(resp);
        assertMimeType(resp, "application/zip");
      }
    );

    return await JSZip.loadAsync(resp.data);
  }

  /**
   * Tries to match a document from the doclist page to a file in the zip archive.
   * Skips files that it cannot match.
   *
   * The files in the zip are formatted like:
   *   00110858-2000-05-23-1002-Designation of inventor.pdf
   *
   * The document metadata includes the document name, e.g. "Designation of inventor".
   *
   * This pulls out the full name from the zip file and compares it. If they match,
   * we'll pull this document from the zip later, otherwise we'll pull it via HTTP.
   */
  mapDocumentsToZipFiles(zip: JSZip, documents: EP.Document[]) {
    const fileNameRegex = /^\d+-\d+-\d+-\d+-\d+-([\w\s]+)\.pdf$/;
    let count = 0;

    console.info("Starting to map documents to zip");

    for (const doc of documents) {
      const files = zip.filter((_, o) => {
        const match = fileNameRegex.exec(o.name);

        if (match) {
          return doc.name.toLowerCase() === match[1].toLowerCase();
        }
      });

      if (files.length === 1) {
        doc.zipFile = files[0];
        count++;
        console.debug(`Mapped "${doc.name}" to "${files[0].name}"`);
      } else if (files.length > 1) {
        console.warn(`Found multiple matches for "${doc.name}", skipping...`);
      } else {
        console.warn(`Failed to map "${doc.name}", skipping...`);
      }
    }

    console.info(
      `-> Done. Successfully mapped ${count} of ${documents.length} documents.`
    );
  }

  /**
   * Fetches the document metadata and tries to download the zip of the documents.
   * If the zip exists, the docs are mapped to the files in the zip.
   */
  async getDocumentList(tab: Page, patent: string) {
    const results = await this.getDocumentMetadata(tab, patent);

    // Make a copy of our results since we're about to filter the document
    // list to remove any which already exist. We'll need this later when
    // we upload the HTML summary of the files.
    this.documentListResults = {
      documents: [...results.documents],
      error: results.error,
    };

    if (results.error) {
      return results;
    }

    results.documents = await this.filterExistingDocuments(results.documents);

    results.documents = this.filterGeneticSequenceDocuments(results.documents);

    // If there are pending documents, try and fetch the zip archive
    if (results.documents.length > 0) {
      try {
        // const zip = await this.getDocumentZip(patent);
        const zip = "" as unknown as JSZip; // hack to force empty zip value to prevent getting 503 errors making zip API call
        this.mapDocumentsToZipFiles(zip, results.documents);
      } catch (e) {
        console.info("Unable to get document zip, skipping...");
      }
    }

    return results;
  }

  /**
   * Fetches a document and returns its contents as a Buffer.
   *
   * This will try and pull the file from the zip if it exists, otherwise
   * it falls back to fetching the file via HTTP.
   */
  async fetchDocument(document: EP.Document) {
    if (document.zipFile) {
      console.debug(`Fetching document "${document.name}" from zip...`);

      return await document.zipFile.async("nodebuffer");
    } else {
      console.debug(`Fetching document "${document.name}" via HTTP...`);

      const resp = await this.fetchWithRetry(
        { url: document.url },
        async (resp) => {
          assertResponseOK(resp);
          assertMimeType(resp, "application/pdf");
        }
      );

      return resp.data as Buffer;
    }
  }

  /**
   * Filters out any documents which already exist on GCP and returns
   * the filtered list.
   */
  async filterExistingDocuments(documents: EP.Document[]) {
    // Update the status of each document based on whether the file
    // already exists in GCP or not
    documents.forEach((doc) => {
      const filepath = this.getGCPFilename(doc);
      doc.filepath = filepath;

      // don't skip any files
      doc.status = "pending";
    });

    // Filter out any documents which aren't pending (i.e. already in GCP)
    return documents.filter((doc) => doc.status === "pending");
  }

  /**
   * Filters out genetic sequence documents and returns the filtered list.
   */
  filterGeneticSequenceDocuments(documents: EP.Document[]) {
    const sequenceTitles = [
      "sequence listing",
      "priority document (electronically transmitted)",
    ];

    return documents.filter(
      (doc) => !sequenceTitles.includes(doc.name.toLowerCase())
    );
  }

  /**
   * Uploads a document to GCP.
   */
  async fetchAndUploadDocument(document: EP.Document) {
    try {
      const data = await this.fetchDocument(document);
      const filePath = `${FILE_PREFIX}/unprocessed/${this.patentNumber}/${document.filepath}`;

      console.info(`Simulating uploading ${filePath}`);
    } catch (e) {
      console.warn("Error downloading file.", { e });
      document.status = "download-failed";
    }
  }

  /**
   * Uploads all the documents to GCP and resolves when all the uploads are finished.
   */
  async fetchAndUploadDocuments(documents: EP.Document[]) {
    console.info(`Starting to upload ${documents.length} documents...`);

    // Using Promise.all() here will likely cause issues with the proxy
    // due to the high number of concurrent requests
    for (const doc of documents) {
      await this.fetchAndUploadDocument(doc);
    }
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
      // Disable the proxy for the OPS requests since we don't need it
      this.proxy.enable = false;

      this.patentNumber = this.getPatentNumber();

      // Get the `start` time
      const start = Date.now();

      // Set the default timeouts
      tab.setDefaultTimeout(60000);
      tab.setDefaultNavigationTimeout(300000);

      // Get the `end` time
      const jsonEnd = Date.now();

      // Log the time it took for this section
      this.timeLog.scrapeJson = Math.floor((jsonEnd - start) / 1000);

      console.debug("Scraped json, moving onto documents.");

      // Get the `start` time
      const startDocuments = Date.now();

      // Turn on the proxy once we're ready to start scraping
      this.proxy.enable = true;

      const results = await this.getDocumentList(tab, this.patentNumber);

      if (results.error) {
        console.info("No documents to fetch, skipping...");
      } else if (results.documents.length === 0) {
        console.info("No missing files found, skipping...");
      } else {
        // Upload all the documents which are missing.
        await this.fetchAndUploadDocuments(results.documents);

        console.debug("Finished scraping files.");
      }

      // Get the `end` time
      const endUploadDocuments = Date.now();

      // Log the time it took for this section
      this.timeLog.scrapeAndUploadFiles = Math.floor(
        (endUploadDocuments - startDocuments) / 1000
      );

      // Add the scraped file list
      this.scrapings.file_list = this.convertFileListToHTML();

      // Upload scraped html
      await this.uploadScrapedHtmlData(
        this.combineAndProcessHtml(this.scrapings)
      );

      // This is here for testing purposes, make sure to comment back out before deploying changes.
      // fs.writeFileSync("test.html", this.combineAndProcessHtml(this.scrapings));

      // Get the `end` time
      const end = Date.now();

      // Log the time it took for this section
      this.timeLog.total = Math.floor((end - start) / 1000);

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
  await new EPScraper().test();
}

// Fire up the main function
(async () => {
  await main();
})();
