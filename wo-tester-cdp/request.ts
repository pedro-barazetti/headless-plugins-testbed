import chalk from "chalk";
import _ from "lodash";
import { delay } from "./utils";
// import { ProxyError } from "./errors";
import axios, { AxiosPromise, AxiosRequestConfig, AxiosResponse } from "axios";

class ProxyError extends Error {
  /** The value of the X-Crawlera-Error header */
  header: string;

  /** The status code of the response */
  code: number;

  constructor(message: string, header: string, code: number) {
    super(message);
    this.header = header;
    this.code = code;
  }
}

export interface RetryOptions {
  delay: number;
  maxRetries: number;
  proxyErrorRetryIndefinitely: boolean;
}

const defaultRetryOptions: RetryOptions = {
  delay: 10,
  maxRetries: 5,
  proxyErrorRetryIndefinitely: true,
};

export type VerifyFunc = (resp: AxiosResponse) => Promise<void>;

export class RequestHandler {
  private requestId = 0;
  readonly retryOptions: RetryOptions;

  constructor(retryOptions: Partial<RetryOptions> = {}) {
    this.retryOptions = _.defaults({ ...retryOptions }, defaultRetryOptions);
  }

  private nextRequestId() {
    // This converts the requestId to a hex string and pads the start
    // with zeroes if it's less than 4 characters
    const id = _.padStart((this.requestId++).toString(16), 4, "0");

    // Reset the id when it gets too large
    if (this.requestId > 0xffff) {
      this.requestId = 0;
    }

    return id;
  }

  /**
   * Runs a request and does some logging, then returns the response. Any errors
   * thrown when making the request will need to be handled manually.
   */
  async getResponse(reqPromise: AxiosPromise, reqConfig: AxiosRequestConfig) {
    let response: AxiosResponse;
    let error: any;

    const id = this.nextRequestId();
    const earlier = Date.now();
    const method = reqConfig.method || "GET";

    console.debug(`[${id}] - ${method} ${reqConfig.url}`);

    try {
      response = await reqPromise;
    } catch (e) {
      error = e;
      console.log(error);
    }

    const elapsed = (Date.now() - earlier) / 1000;
    let timeText = `${elapsed.toFixed(3)}s`;

    // Color code the response time based on how long it took
    if (elapsed < 1.5) {
      timeText = chalk.green(timeText);
    } else if (elapsed < 3) {
      timeText = chalk.yellow(timeText);
    } else if (elapsed < 5) {
      timeText = chalk.rgb(255, 128, 0)(timeText);
    } else {
      timeText = chalk.red(timeText);
    }

    console.debug(
      `[${id}] - ${timeText} - ${response.status} - ${method} ${reqConfig.url}`
    );

    if (error) {
      throw error;
    }

    const proxyErr = getProxyErrorFromResponse(response);

    if (proxyErr) {
      throw proxyErr;
    }

    return response;
  }

  /**
   * Calls getResponse and retries if it throws. If the max number of retries is reached,
   * the last caught error is thrown.
   *
   * @param verifyFunc    An optional callback which is called after a successful request.
   *                      This callback should throw if the response is not acceptable.
   */
  async getResponseWithRetry(payload, verifyFunc?: VerifyFunc) {
    let resp: AxiosResponse;
    let error: any;

    for (let i = 0; i < this.retryOptions.maxRetries; i++) {
      try {
        const req = axios.request(payload);
        resp = await this.getResponse(req, payload);

        if (verifyFunc) {
          await verifyFunc(resp);
        }

        return resp;
      } catch (e) {
        error = e;

        if (e instanceof ProxyError) {
          // Proxy errors with a 4xx status code should not be retried
          // since they will always fail
          if (400 <= e.code && e.code < 500) {
            console.warn("Proxy request failed with a non-500 error code", {
              code: e.code,
              reason: e.message,
              stack: e.stack,
            });

            // Do not retry 4xx proxy errors
            break;
          } else if (
            e.code >= 500 &&
            this.retryOptions.proxyErrorRetryIndefinitely
          ) {
            console.warn(`Proxy error: Retrying (reason: ${e.message || "-"})`);
            console.debug("Not counting proxy error towards max retries");
            i--;
          }
        } else {
          console.warn(`Retrying (reason: ${e.message || "-"})`);
        }

        if (e.stack) {
          console.debug(e.stack);
        }
      }

      await delay(this.retryOptions.delay);
    }

    throw error;
  }
}

/**
 * Returns a slice of the response body as a utf-8 string.
 */
export function getResponseBodySlice(resp: AxiosResponse, sliceSize = 200) {
  let body = "";

  if (Buffer.isBuffer(resp.data)) {
    body = (resp.data as Buffer).subarray(0, sliceSize).toString("utf-8");
  } else {
    body = (resp.data as string).substr(0, sliceSize);
  }

  return body;
}

/**
 * Returns the mime type of the response, e.g. application/json
 */
export function mimeType(resp: AxiosResponse) {
  const contentType = resp.headers["content-type"];

  if (!contentType) {
    throw new Error("Content-Type header is missing");
  }

  return String(contentType).split(";")[0];
}

/**
 * Asserts that the mime type of the response matches what is expected.
 * If it doesn't match, throws an error with the expected and actual mime type.
 */
export function assertMimeType(resp: AxiosResponse, expected: string) {
  const contentType = mimeType(resp);

  if (contentType !== expected) {
    const msg = `Expected ${expected} response but got ${contentType}`;

    console.warn(msg, {
      url: resp.request.uri.href,
      body: getResponseBodySlice(resp),
      contentLength: resp.headers["content-length"],
    });

    throw new Error(msg);
  }
}

/**
 * Asserts that the response does not have a 4xx or 5xx error code.
 */
export function assertResponseOK(resp: AxiosResponse) {
  if (resp.status >= 400) {
    const msg = `${resp.status} - ${resp.statusText}`;

    console.warn(`Bad status code: ${msg}`, {
      url: resp.request.uri.href,
      body: getResponseBodySlice(resp),
      contentLength: resp.headers["content-length"],
    });

    throw new Error(`${resp.status} - ${resp.statusText}`);
  }
}

/**
 * Checks the response for a proxy error and returns it if there is one.
 * Otherwise it returns null.
 *
 * TODO: Replace `getProxyError` with this function instead.
 */
export function getProxyErrorFromResponse(resp: AxiosResponse) {
  const header = resp.headers["x-crawlera-error"] as string | undefined;

  if (header) {
    const msg = `Received ${resp.status} error from Zyte (${header})`;
    return new ProxyError(msg, header, resp.status);
  }

  return null;
}
