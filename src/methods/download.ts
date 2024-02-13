import { ResponseType } from "axios";

import { S5Client } from "../client.js";
import { CustomClientOptions, optionsToConfig } from "../utils/options.js";
import path from "path";
import { DEFAULT_UPLOAD_OPTIONS } from "#methods/upload.js";
import {
  getS5BlobCid,
  getS5DownloadCid,
  getS5MetadataCid,
} from "#generated/index.js";
import { addUrlQuery } from "#utils/url.js";
import { customInstance } from "#axios.js";

/**
 * Custom download options.
 *
 * @property [endpointDownload] - The relative URL path of the portal endpoint to contact.
 * @property [download=false] - Indicates to `getCidUrl` whether the file should be downloaded (true) or opened in the browser (false). `downloadFile` and `openFile` override this value.
 * @property [path] - A path to append to the cid, e.g. `dir1/dir2/file`. A Unix-style path is expected. Each path component will be URL-encoded.
 * @property [range] - The Range request header to set for the download. Not applicable for in-borwser downloads.
 * @property [responseType] - The response type.
 * @property [subdomain=false] - Whether to return the final cid in subdomain format.
 */
export type CustomDownloadOptions = CustomClientOptions & {
  path?: string;
  range?: string;
  responseType?: ResponseType;
};

export type CustomGetMetadataOptions = CustomClientOptions & {};

/**
 * The response for a get metadata request.
 *
 * @property metadata - The metadata in JSON format.
 * @property portalUrl - The URL of the portal.
 * @property cid - 46-character cid.
 */
export type MetadataResult = {
  metadata: Record<string, unknown>;
};

export const DEFAULT_DOWNLOAD_OPTIONS = {
  range: undefined,
  responseType: undefined,
  subdomain: "",
} as CustomDownloadOptions;

const DEFAULT_GET_METADATA_OPTIONS = {};

/**
 * Initiates a download of the content of the cid within the browser.
 *
 * @param this - S5Client
 * @param cid - 46-character cid, or a valid cid URL. Can be followed by a path. Note that the cid will not be encoded, so if your path might contain special characters, consider using `customOptions.path`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL that was used.
 * @throws - Will throw if the cid does not contain a cid or if the path option is not a string.
 */
export async function downloadFile(
  this: S5Client,
  cid: string,
  customOptions?: CustomDownloadOptions,
): Promise<string> {
  const url = await this.getCidUrl(cid, customOptions);

  // Download the url.
  window.location.assign(url);

  return url;
}

/**
 * Constructs the full URL for the given cid.
 *
 * @param this - S5Client
 * @param cid - Base64 cid, or a valid URL that contains a cid. See `downloadFile`.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointDownload="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The full URL for the cid.
 * @throws - Will throw if the cid does not contain a cid or if the path option is not a string.
 */
export async function getCidUrl(
  this: S5Client,
  cid: string,
  customOptions: CustomDownloadOptions = {},
): Promise<string> {
  const opt = { ...this.customOptions, customOptions };
  return addUrlQuery(path.join(this.portalUrl, cid), {
    auth_token: opt.ApiKey,
  });
}

/**
 * Gets only the metadata for the given cid without the contents.
 *
 * @param this - S5Client
 * @param cid - Base64 cid.
 * @param [customOptions] - Additional settings that can optionally be set. See `downloadFile` for the full list.
 * @param [customOptions.endpointGetMetadata="/"] - The relative URL path of the portal endpoint to contact.
 * @returns - The metadata in JSON format. Empty if no metadata was found.
 * @throws - Will throw if the cid does not contain a cid .
 */
export async function getMetadata(
  this: S5Client,
  cid: string,
  customOptions: CustomGetMetadataOptions = {},
): Promise<MetadataResult> {
  const config = optionsToConfig(
    this,
    DEFAULT_GET_METADATA_OPTIONS,
    customOptions,
  );

  const response = await getS5MetadataCid(cid, config);

  return { metadata: response };
}

/**
 * Downloads in-memory data from a S5 cid.
 * @param this - S5Client
 * @param cid - 46-character cid, or a valid cid URL.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The data
 */
export async function downloadData(
  this: S5Client,
  cid: string,
  customOptions: CustomDownloadOptions = {},
): Promise<ArrayBuffer> {
  const opts = {
    ...DEFAULT_DOWNLOAD_OPTIONS,
    ...this.customOptions,
    ...customOptions,
    download: true,
  };

  const config = optionsToConfig(this, DEFAULT_DOWNLOAD_OPTIONS, customOptions);

  return await (await getS5DownloadCid(cid, config)).arrayBuffer();
}

/**
 * Downloads a proof for the given cid.
 * @param this - S5Client
 * @param cid - 46-character cid, or a valid cid URL.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The data
 */
export async function downloadProof(
  this: S5Client,
  cid: string,
  customOptions: CustomDownloadOptions = {},
): Promise<ArrayBuffer> {
  return this.downloadData(`${cid}.obao`, customOptions);
}

/**
 * Downloads a blob from the given cid. This will capture a 301 redirect to the actual blob location, then download the blob.
 * @param this - S5Client
 * @param cid - 46-character cid, or a valid cid URL.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The data
 */
export async function downloadBlob(
  this: S5Client,
  cid: string,
  customOptions: CustomDownloadOptions = {},
): Promise<ArrayBuffer> {
  const config = optionsToConfig(this, DEFAULT_DOWNLOAD_OPTIONS, customOptions);

  let location: string | null = null;

  await getS5BlobCid(cid, {
    ...config,
    responseType: "arraybuffer",
    beforeRedirect: (config, responseDetails) => {
      location = responseDetails.headers["location"];
    },
  });

  if (!location) {
    throw new Error("Failed to download blob");
  }

  return await customInstance<ArrayBuffer>(
    {
      url: `/s5/blob/${cid}`,
      method: "GET",
      responseType: "arraybuffer",
    },
    config,
  );
}
