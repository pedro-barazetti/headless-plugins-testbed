import { JSZipObject } from "jszip";

export interface TimeLog {
    total: number;
    scrapeDetails: number;
    scrapeAndUploadFiles: number;
    scrapeJson: number;
}

export interface Document {
    date: string;
    name: string;
    id: string;
    type: string;
    numberOfPages: string;
    url: string;
    zipFile: JSZipObject | null;
    status?: "scraped" | "pending" | "download-failed";
    filepath?: string;
}

// Sometimes the document list page doesn't have any results.
// Unavailable example: https://register.epo.org/application?lng=en&tab=doclist&number=EP90301127
// Destroyed example: https://register.epo.org/application?lng=en&tab=doclist&number=EP84308013
// `table-missing` is a special case where we didn't detect any errors but the
// <table> element was missing.
export type DocumentListError = "unavailable" | "destroyed" | "table-missing";

export interface DocumentListResults {
    documents: Document[];
    error: DocumentListError | null;
}

/*
    Example response:

    {
        "refresh_token_expires_in": "0",
        "api_product_list": "[ops-prod]",
        "api_product_list_json": [
            "ops-prod"
        ],
        "organization_name": "epo",
        "developer.email": "dfeldmeier@twindolphinsoftware.com",
        "token_type": "BearerToken",
        "issued_at": "1642625581319",
        "client_id": "OVb49ciqPLw9vzxyN1GmECUa5OmZo4ru",
        "access_token": "XLdP9wG7fAH01eV8HmoofIQqMWC4",
        "application_name": "949a041d-31ca-457c-a19b-2ffd28e4e967",
        "scope": "core",
        "expires_in": "1199",
        "refresh_count": "0",
        "status": "approved"
    }
*/
export interface OPSAuthToken {
    access_token: string;
}
