export interface TimeLog {
    scrapeDetails: number;
    scrapeDocuments: number;
    scrapeFiles: number;
    scrapeNationalPhases: number;
    scrapeNotices: number;
    total: number;
    uploadFiles: number;
}

export interface DocumentURL {
    type: string;
    url: string;
    pageCount?: number;
    docId?: string;
}

export interface Document {
    date: string;
    name: string;
    numberOfPages: string;
    urls: DocumentURL[];
    group: string;
    status?: "scraped" | "pending" | "download-failed";
    fileName?: string;
    pdfUrl?: string;
    docId?: string;
    txtUrl?: string;
}

export interface ScrapeState {
    file_list: string;
    details: string;
    nationalPhases: string;
    notices: string;
}
