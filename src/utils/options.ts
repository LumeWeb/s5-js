import { AxiosHeaders, AxiosProgressEvent, AxiosRequestConfig } from "axios";
import { S5Client } from "../client.js";

/**
 * Custom client options.
 *
 * @property [apiKey] - Authentication password to use for a single S5 node/portal.
 * @property [customUserAgent] - Custom user agent header to set.
 * @property [customCookie] - Custom cookie header to set. WARNING: the Cookie header cannot be set in browsers. This is meant for usage in server contexts.
 * @property [onDownloadProgress] - Optional callback to track download progress.
 * @property [onUploadProgress] - Optional callback to track upload progress.
 */

export type CustomClientOptions = {
  apiKey?: string;
  customUserAgent?: string;
  customCookie?: string;
  onDownloadProgress?: (progressEvent: AxiosProgressEvent) => void;
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
};

export function optionsToConfig(
  client: S5Client,
  def: CustomClientOptions,
  ...options: CustomClientOptions[]
): AxiosRequestConfig {
  const config: AxiosRequestConfig = {};

  config.baseURL = client.portalUrl;

  const extraOptions = options.reduce((acc, val) => {
    return {
      ...acc,
      ...val,
    };
  }, options);

  const finalOptions = {
    ...def,
    ...client.customOptions,
    ...extraOptions,
  } as CustomClientOptions;

  if (finalOptions?.onDownloadProgress) {
    config.onDownloadProgress = finalOptions?.onDownloadProgress;
  }

  if (finalOptions?.onUploadProgress) {
    config.onUploadProgress = finalOptions?.onUploadProgress;
  }

  const headers = new AxiosHeaders(config.headers as AxiosHeaders);

  if (finalOptions?.customCookie) {
    headers.set("Cookie", finalOptions.customCookie);
  }
  if (finalOptions?.customUserAgent) {
    headers.set("User-Agent", finalOptions.customUserAgent);
  }

  if (finalOptions?.apiKey) {
    headers.set("Authorization", `Bearer ${finalOptions.apiKey}`);
    config.withCredentials = true;

    config.params = {
      ...config.params,
      auth_token: finalOptions?.apiKey,
    };
  }

  config.headers = headers;

  return config;
}
