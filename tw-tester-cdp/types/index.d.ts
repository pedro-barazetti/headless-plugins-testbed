/// <reference lib="node-fetch" />

declare type ScraperType =
  | "us_public_scrape"
  | "us_private_scrape"
  | "cn_scrape"
  | "jp_scrape"
  | "tw_scrape"
  | "wo_scrape"
  | "ep_scrape"
  | "in_scrape";

declare type LoginQueues = "us_login" | "cn_login";

declare type QueueTypes = ScraperType | LoginQueues;

declare type ScrapeStatus = "success" | "throttled" | "error";

// NOTE: This is not an exhaustive list of statuses, just the ones that we are using.
declare type QueueEntryStatus =
  | "insert_end"
  | "scrape_end"
  | "login_end"
  | "begin_hold"
  | "scrape_error_not_found"
  | "scrape_error";

declare interface ScrapeResults {
  loginStatus?: ScrapeStatus;
  queueStatus?: ScrapeStatus;
  status?: ScrapeStatus;
  error?: Error;
  useProxy?: boolean;
  available?: boolean;
  timeLog?: any;
  xmlUnavailable?: boolean;
  entry?: QueueEntry;
  switchProxy?: boolean;
  forceLogin?: boolean;
  restartBrowser?: boolean;

  /** A partial scrape is essentially when any of the documents we're scraping
   * are unable to be retrieved. For example, we tried downloading the document
   * but we were throttled, or the account we're using is banned, etc.
   *
   * This is distinct from documents which may be optional and are missing
   */
  partialScrape?: boolean;
}

declare interface Cookie {
  name: string;
  value: string;
}

declare interface NextQidResponse {
  response: Response;
  responseData: {
    entry: QueueEntry;
  };
}

declare interface QueueEntryCommon {
  qid: string;
  etag: string;
}

declare interface LoginEntryPayload {
  cookies?: string;
  dataset?: string;
  heartbeat?: string;
  pair_cert?: string;
  password?: string;
  sessionstorage?: string;
  throttled?: string | number;
  timeLog?: any;
  username?: string;
  writer?: string;
}

declare interface QueueEntryPayload {
  app_no?: string;
  cookies?: string;
  dataset?: string;
  heartbeat?: string;
  id?: string;
  opd_unavailable?: boolean;
  partialScrape?: boolean;
  password?: string;
  pat_type?: string;
  patent_number_not_found?: boolean;
  patent_type_incorrect?: boolean;
  payload?: QueueEntryPayload;
  sessionstorage?: string;
  throttled?: string | number;
  timeLog?: any;
  username?: string;
  writer?: string;
  xml_customer?: string;
  xml_unavailable?: boolean;
}

declare interface LoginQueueCounts extends LoginEntryPayload {
  count: number;
}

declare interface QueueItemData extends QueueEntryCommon {
  entry: QueueEntryPayload;
}

declare interface LoginItemData extends QueueEntryCommon {
  entry: LoginEntryPayload;
}

declare interface NextQueueEntry {
  loginItem?: LoginItemData;
  queueItem?: QueueItemData;
}

interface Proxy {
  enable: boolean;
  cert: string;
  url: string;
}

interface ProxyConfig {
  /** The API key for the proxy */
  key: string;

  /** The proxy URL which includes auth, suitable when using `request` */
  url: string;
}
