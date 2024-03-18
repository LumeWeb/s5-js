import { AxiosProgressEvent } from "axios";
import {
  DetailedError,
  HttpRequest,
  Upload,
  UploadOptions,
} from "tus-js-client";

import { blake3 } from "@noble/hashes/blake3";
import { Buffer } from "buffer";

import { getFileMimeType } from "../utils/file.js";
import { S5Client } from "../client.js";
import { CID, CID_HASH_TYPES, CID_TYPES } from "@lumeweb/libs5";
import {
  type BasicUploadResponse,
  postS5Upload,
  postS5UploadDirectory,
  PostS5UploadDirectoryParams,
  PostS5UploadResult,
} from "#generated/index.js";
import { BaseCustomOptions } from "#methods/registry.js";
import { optionsToConfig } from "#utils/options.js";
import { buildRequestUrl } from "#request.js";
import defer from "p-defer";
import { Multihash } from "@lumeweb/libs5/lib/multihash.js";

/**
 * The tus chunk size is (4MiB - encryptionOverhead) * dataPieces, set as default.
 */
export const TUS_CHUNK_SIZE = (1 << 22) * 8;

/**
 * The retry delays, in ms. Data is stored in for up to 20 minutes, so the
 * total delays should not exceed that length of time.
 */
const DEFAULT_TUS_RETRY_DELAYS = [0, 5_000, 15_000, 60_000, 300_000, 600_000];

/**
 * The portal file field name.
 */
const PORTAL_FILE_FIELD_NAME = "file";

const TUS_ENDPOINT = "/s5/upload/tus";

/**
 * Custom upload options.
 *
 * @property [largeFileSize=32943040] - The size at which files are considered "large" and will be uploaded using the tus resumable upload protocol. This is the size of one chunk by default (32 mib). Note that this does not affect the actual size of chunks used by the protocol.
 * @property [errorPages] - Defines a mapping of error codes and subfiles which are to be served in case we are serving the respective error code. All subfiles referred like this must be defined with absolute paths and must exist.
 * @property [retryDelays=[0, 5_000, 15_000, 60_000, 300_000, 600_000]] - An array or undefined, indicating how many milliseconds should pass before the next attempt to uploading will be started after the transfer has been interrupted. The array's length indicates the maximum number of attempts.
 * @property [tryFiles] - Allows us to set a list of potential subfiles to return in case the requested one does not exist or is a directory. Those subfiles might be listed with relative or absolute paths. If the path is absolute the file must exist.
 */
export type CustomUploadOptions = BaseCustomOptions & {
  errorPages?: Record<string, string>;
  tryFiles?: string[];

  // Large files.
  largeFileSize?: number;
  retryDelays?: number[];
  onUploadProgress?: (progressEvent: AxiosProgressEvent) => void;
};

export const DEFAULT_UPLOAD_OPTIONS = {
  errorPages: { 404: "/404.html" },
  tryFiles: ["index.html"],

  // Large files.
  largeFileSize: TUS_CHUNK_SIZE,
  retryDelays: DEFAULT_TUS_RETRY_DELAYS,
} as CustomUploadOptions;

export interface UploadResult {
  cid: CID;
}

/**
 * Uploads a file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The returned cid.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadFile(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions = {},
): Promise<any> {
  const opts = {
    ...DEFAULT_UPLOAD_OPTIONS,
    ...this.clientOptions,
    ...customOptions,
  } as CustomUploadOptions;

  if (file.size < <number>opts?.largeFileSize) {
    return this.uploadSmallFile(file, opts);
  } else {
    return this.uploadLargeFile(file, opts);
  }
}

/**
 * Uploads a small file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.

 * @returns UploadResult - The returned cid.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadSmallFile(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions,
): Promise<UploadResult> {
  const response = await this.uploadSmallFileRequest(file, customOptions);

  return { cid: CID.decode(<string>response.CID) };
}

/**
 * Makes a request to upload a small file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.

 * @returns PostS5UploadResult  - The upload response.
 */
export async function uploadSmallFileRequest(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions = {},
): Promise<PostS5UploadResult> {
  const config = optionsToConfig(this, DEFAULT_UPLOAD_OPTIONS, customOptions);

  file = ensureFileObjectConsistency(file);

  return postS5Upload(
    {
      file: file,
    },
    config,
  );
}

/* istanbul ignore next */
/**
 * Uploads a large file to S5-net using tus.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointLargeUpload="/s5/upload/tus"] - The relative URL path of the portal endpoint to contact.
 * @returns - The returned cid.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadLargeFile(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions = {},
): Promise<UploadResult> {
  return await this.uploadLargeFileRequest(file, customOptions);
}

/* istanbul ignore next */
/**
 * Makes a request to upload a file to S5-net.
 *
 * @param this - S5Client
 * @param file - The file to upload.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The upload response.
 */
export async function uploadLargeFileRequest(
  this: S5Client,
  file: File,
  customOptions: CustomUploadOptions = {},
): Promise<UploadResult> {
  const p = defer<UploadResult>();

  const options = await this.getTusOptions(
    file,
    {
      onSuccess: async () => {
        if (!upload.url) {
          p.reject(new Error("'upload.url' was not set"));
          return;
        }

        p.resolve({ cid });
      },
      onError: (error: Error | DetailedError) => {
        // Return error body rather than entire error.
        const res = (error as DetailedError).originalResponse;
        const newError = res ? new Error(res.getBody().trim()) || error : error;
        p.reject(newError);
      },
    },
    customOptions,
  );
  const cid = CID.fromHash(
    Multihash.fromBase64Url(<string>options.metadata?.hash).fullBytes,
    file.size,
    CID_TYPES.RAW,
  );

  const upload = new Upload(file, options);

  return p.promise;
}

export async function getTusOptions(
  this: S5Client,
  file: File,
  tusOptions: Partial<UploadOptions> = {},
  customOptions: CustomUploadOptions = {},
): Promise<UploadOptions> {
  const config = optionsToConfig(this, DEFAULT_UPLOAD_OPTIONS, customOptions);

  // Validation.
  const url = await buildRequestUrl(this, {
    endpointPath: TUS_ENDPOINT,
  });

  file = ensureFileObjectConsistency(file);

  const hasher = blake3.create({});

  const chunkSize = 1024 * 1024;

  let position = 0;

  while (position <= file.size) {
    const chunk = file.slice(position, position + chunkSize);
    hasher.update(new Uint8Array(await chunk.arrayBuffer()));
    position += chunkSize;
  }

  const b3hash = hasher.digest();

  const filename = new Multihash(
    Buffer.concat([
      Buffer.alloc(1, CID_HASH_TYPES.BLAKE3),
      Buffer.from(b3hash),
    ]),
  ).toBase64Url();

  return {
    endpoint: url,
    metadata: {
      hash: filename,
      filename: filename,
      filetype: file.type,
    },
    headers: config.headers as any,
    onBeforeRequest: function (req: HttpRequest) {
      const xhr = req.getUnderlyingObject();
      xhr.withCredentials = true;
    },
    ...tusOptions,
  };
}

/**
 * Uploads a directory to S5-net.
 *
 * @param this - S5Client
 * @param directory - File objects to upload, indexed by their path strings.
 * @param filename - The name of the directory.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointPath="/s5/upload/directory"] - The relative URL path of the portal endpoint to contact.
 * @returns - The returned cid.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
export async function uploadDirectory(
  this: S5Client,
  directory: Record<string, File>,
  filename: string,
  customOptions: CustomUploadOptions = {},
): Promise<UploadResult> {
  const response = await this.uploadDirectoryRequest(
    directory,
    filename,
    customOptions,
  );

  return { cid: CID.decode(<string>response.CID) };
}

/**
 * Makes a request to upload a directory to S5-net.
 *
 * @param this - S5Client
 * @param directory - File objects to upload, indexed by their path strings.
 * @param filename - The name of the directory.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @returns - The upload response.
 * @throws - Will throw if the input filename is not a string.
 */
export async function uploadDirectoryRequest(
  this: S5Client,
  directory: Record<string, File>,
  filename: string,
  customOptions: CustomUploadOptions = {},
): Promise<BasicUploadResponse> {
  const config = optionsToConfig(this, DEFAULT_UPLOAD_OPTIONS, customOptions);

  const formData = new FormData();

  for (const entry in directory) {
    const file = ensureFileObjectConsistency(directory[entry]);
    formData.append(entry, file, entry);
  }

  const params = {} as PostS5UploadDirectoryParams;

  if (customOptions.tryFiles) {
    params.tryFiles = customOptions.tryFiles;
  }
  if (customOptions.errorPages) {
    params.errorPages = customOptions.errorPages;
  }

  params.name = filename;

  /*
  Hack to pass the data right since OpenAPI doesn't support variable file inputs without knowing the names ahead of time.
   */
  config.data = formData;

  return postS5UploadDirectory({}, params, config);
}

export async function uploadWebapp(
  this: S5Client,
  directory: Record<string, File>,
  customOptions: CustomUploadOptions = {},
): Promise<UploadResult> {
  const response = await this.uploadWebappRequest(directory, customOptions);

  return { cid: CID.decode(<string>response.CID) };
}

/**
 * Makes a request to upload a directory to S5-net.
 * @param this - S5Client
 * @param directory - File objects to upload, indexed by their path strings.
 * @param [customOptions] - Additional settings that can optionally be set.
 * @param [customOptions.endpointPath] - The relative URL path of the portal endpoint to contact.
 * @returns - The upload response.
 * @throws - Will throw if the input filename is not a string.
 */
export async function uploadWebappRequest(
  this: S5Client,
  directory: Record<string, File>,
  customOptions: CustomUploadOptions = {},
): Promise<BasicUploadResponse> {
  return this.uploadDirectoryRequest(directory, "webapp", customOptions);
}

/**
 * Sometimes file object might have had the type property defined manually with
 * Object.defineProperty and some browsers (namely firefox) can have problems
 * reading it after the file has been appended to form data. To overcome this,
 * we recreate the file object using native File constructor with a type defined
 * as a constructor argument.
 *
 * @param file - The input file.
 * @returns - The processed file.
 */
function ensureFileObjectConsistency(file: File): File {
  return new File([file], file.name, { type: getFileMimeType(file) });
}

/**
 * convert a number to Buffer.
 *
 * @param value - File objects to upload, indexed by their path strings.
 * @returns - The returned cid.
 * @throws - Will throw if the request is successful but the upload response does not contain a complete response.
 */
function numberToBuffer(value: number) {
  const view = Buffer.alloc(16);
  let lastIndex = 15;
  for (let index = 0; index <= 15; ++index) {
    if (value % 256 !== 0) {
      lastIndex = index;
    }
    view[index] = value % 256;
    value = value >> 8;
  }
  return view.subarray(0, lastIndex + 1);
}

function base64Decode(data) {
  const paddedData = data.padEnd(Math.ceil(data.length / 4) * 4, "=");

  const base64 = paddedData.replace(/-/g, "+").replace(/_/g, "/");

  return Buffer.from(base64, "base64");
}
