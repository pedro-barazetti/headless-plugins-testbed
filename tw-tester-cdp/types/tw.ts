export interface Document {
  url: string;
  caseReasonName: string;
  showName: string;
  exists?: boolean;
  transName?: string;
  downloadUrl?: string;
  fileName?: string;
  scrapedHTML?: string;

  // TODO: Update TW scraper to include more statuses
  status?: "download-failed";
}

export interface CaseFile {
  docNumber: string;
  docDate: string;
  summary: string;
  documents: Document[];
}

export interface BaseScrapeState {
  patent_information: string;
  transaction: string;
  status: string;
  case_information: string;
  case_file_list: string;
  file_list: string;
}

export interface ScrapeState extends BaseScrapeState {
  scraped_html_files: Record<string, string>;
}

export interface ScrapeResults extends BaseScrapeState {
  scraped_html_files: string;
}

export type PatentSearchResult = "no-result" | "detail-page" | "results-page";
