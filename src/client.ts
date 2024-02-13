import axios, {
  AxiosError,
  AxiosProgressEvent,
  AxiosRequestConfig,
} from "axios";
import type { AxiosResponse, ResponseType, Method } from "axios";

import {
  uploadFile,
  uploadLargeFile,
  uploadDirectory,
  uploadDirectoryRequest,
  uploadSmallFile,
  uploadSmallFileRequest,
  uploadLargeFileRequest,
  uploadWebapp,
  uploadWebappRequest,
} from "./methods/upload.js";
import {
  downloadBlob,
  downloadData,
  downloadFile,
  downloadProof,
  getCidUrl,
  getMetadata,
} from "./methods/download.js";

import { ensureUrl } from "./utils/url.js";

import {
  createEntry,
  getEntry,
  publishEntry,
  subscribeToEntry,
} from "./methods/registry.js";
import { CustomClientOptions } from "#utils/options.js";
import { throwValidationError } from "#utils/validation.js";

/**
 * The S5 Client which can be used to access S5-net.
 */
export class S5Client {
  // Upload
  uploadFile = uploadFile;
  uploadDirectory = uploadDirectory;
  // Set methods (defined in other files).
  uploadWebapp = uploadWebapp;
  downloadFile = downloadFile;
  downloadData = downloadData;
  downloadBlob = downloadBlob;
  downloadProof = downloadProof;
  getCidUrl = getCidUrl;
  getMetadata = getMetadata;
  // Registry
  subscribeToEntry = subscribeToEntry;
  publishEntry = publishEntry;
  createEntry = createEntry;
  getEntry = getEntry;
  // Download
  protected uploadSmallFile = uploadSmallFile;
  protected uploadSmallFileRequest = uploadSmallFileRequest;
  protected uploadLargeFile = uploadLargeFile;
  protected uploadLargeFileRequest = uploadLargeFileRequest;
  protected uploadDirectoryRequest = uploadDirectoryRequest;
  protected uploadWebappRequest = uploadWebappRequest;

  /**
   * The S5 Client which can be used to access S5-net.
   *
   * @class
   * @param [portalUrl] The initial portal URL to use to access S5, if specified. A request will be made to this URL to get the actual portal URL. To use the default portal while passing custom options, pass "".
   * @param [customOptions] Configuration for the client.
   */
  constructor(portalUrl: string, customOptions: CustomClientOptions = {}) {
    if (!portalUrl) {
      throwValidationError("portalUrl", portalUrl, "parameter", "string");
    }
    this._portalUrl = ensureUrl(portalUrl);
    this._customOptions = customOptions;
  }

  private _customOptions: CustomClientOptions;

  get customOptions(): CustomClientOptions {
    return this._customOptions;
  }

  private _portalUrl: string;

  get portalUrl(): string {
    return this._portalUrl;
  }

  public static create(
    portalUrl: string,
    customOptions: CustomClientOptions = {},
  ) {
    return new S5Client(portalUrl, customOptions);
  }
}
