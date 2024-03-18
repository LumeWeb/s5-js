import { S5Client } from "../client.js";
import { ensureBytes, equalBytes } from "@noble/curves/abstract/utils";

import WS from "isomorphic-ws";
import {
  CID,
  createKeyPair,
  KeyPairEd25519,
  Packer,
  REGISTRY_TYPES,
  SignedRegistryEntry,
} from "@lumeweb/libs5";
import {
  deserializeRegistryEntry,
  signRegistryEntry,
  verifyRegistryEntry,
} from "@lumeweb/libs5/lib/service/registry.js";
import { Buffer } from "buffer";
import { throwValidationError } from "../utils/validation.js";
import { base64url } from "multiformats/bases/base64";
import { concatBytes } from "@noble/hashes/utils";
import { CID_HASH_TYPES } from "@lumeweb/libs5/lib/constants.js";
import { CustomClientOptions, optionsToConfig } from "#utils/options.js";
import { buildRequestUrl } from "#request.js";
import {
  getS5Registry,
  postS5Registry,
  type RegistrySetRequest,
} from "#generated/index.js";
import { DEFAULT_UPLOAD_OPTIONS } from "#methods/upload.js";
import { AxiosError } from "axios";

export const DEFAULT_GET_ENTRY_OPTIONS = {};

export const DEFAULT_SET_ENTRY_OPTIONS = {
  endpointSetEntry: "/s5/registry",
};

export const DEFAULT_SUBSCRIBE_ENTRY_OPTIONS = {
  endpointSubscribeEntry: "/s5/registry/subscription",
} as CustomRegistryOptions;

export const DEFAULT_PUBLISH_ENTRY_OPTIONS = {
  endpointPublishEntry: "/s5/registry",
} as CustomRegistryOptions;

export type BaseCustomOptions = CustomClientOptions;

export type CustomRegistryOptions = BaseCustomOptions & {
  endpointSubscribeEntry?: string;
  endpointPublishEntry?: string;
};

export async function subscribeToEntry(
  this: S5Client,
  publicKey: Uint8Array,
  customOptions: CustomRegistryOptions = {},
) {
  const opts = {
    ...DEFAULT_SUBSCRIBE_ENTRY_OPTIONS,
    ...this.clientOptions,
    ...customOptions,
  };

  publicKey = ensureBytes("public key", publicKey, 32);
  publicKey = concatBytes(Uint8Array.from([CID_HASH_TYPES.ED25519]), publicKey);

  const url = await buildRequestUrl(this, {
    baseUrl: await this.portalUrl,
    endpointPath: opts.endpointSubscribeEntry,
  });

  const wsUrl = url.replace(/^http/, "ws");

  const socket = new WS(wsUrl);
  socket.binaryType = "arraybuffer";

  socket.addEventListener("open", () => {
    const packer = new Packer();
    packer.pack(2);
    packer.pack(publicKey);

    socket.send(packer.takeBytes());
  });

  return {
    listen(cb: (entry: SignedRegistryEntry) => void) {
      socket.addEventListener("message", (data) => {
        cb(deserializeRegistryEntry(new Uint8Array(data.data as Buffer)));
      });
    },
    end() {
      if ([socket.CLOSING, socket.CLOSED].includes(socket.readyState as any)) {
        return;
      }
      socket.close();
    },
  };
}

const base64urlEncode = (d: Uint8Array) => base64url.encode(d).substring(1);
const base64urlDecode = (d: string) => base64url.decode(`u${d}`);

export async function publishEntry(
  this: S5Client,
  signedEntry: SignedRegistryEntry,
  customOptions: CustomRegistryOptions = {},
) {
  const config = optionsToConfig(
    this,
    DEFAULT_PUBLISH_ENTRY_OPTIONS,
    customOptions,
  );

  if (!verifyRegistryEntry(signedEntry)) {
    throwValidationError(
      "signedEntry", // name of the variable
      signedEntry, // actual value
      "parameter", // valueKind (assuming it's a function parameter)
      "a valid signed registry entry", // expected description
    );
  }

  return postS5Registry(
    {
      pk: base64urlEncode(signedEntry.pk),
      revision: signedEntry.revision,
      data: base64urlEncode(signedEntry.data),
      signature: base64urlEncode(signedEntry.signature),
    },
    config,
  );
}

export async function createEntry(
  this: S5Client,
  sk: Uint8Array | KeyPairEd25519,
  cid: CID,
  revision = 0,
) {
  if (sk instanceof Uint8Array) {
    sk = createKeyPair(sk);
  }

  let existing = true;
  let entry = await this.getEntry(sk.publicKey);

  if (!entry) {
    existing = false;
    entry = {
      pk: sk.publicKey,
      data: cid.toRegistryEntry(),
      revision,
    } as unknown as SignedRegistryEntry;
  }

  if (!equalBytes(sk.publicKey, entry.pk)) {
    throwValidationError(
      "entry.pk", // name of the variable
      Buffer.from(entry.pk).toString("hex"), // actual value
      "result", // valueKind (assuming it's a function parameter)
      Buffer.from(sk.publicKey).toString("hex"), // expected description
    );
  }

  if (existing) {
    const newEntry = cid.toRegistryEntry();
    if (equalBytes(entry.data, newEntry)) {
      return entry;
    }

    entry.revision++;
    entry.data = newEntry;
  }
  const signedEntry = signRegistryEntry({
    kp: sk,
    data: entry.data,
    revision: entry.revision,
  });

  await this.publishEntry(signedEntry);

  return signedEntry;
}

export async function getEntry(
  this: S5Client,
  publicKey: Uint8Array,
  customOptions: CustomRegistryOptions = {},
) {
  const config = optionsToConfig(
    this,
    DEFAULT_GET_ENTRY_OPTIONS,
    customOptions,
  );

  try {
    const ret = await getS5Registry(
      {
        pk: base64urlEncode(publicKey),
      },
      config,
    );

    const signedEntry = {
      pk: base64urlDecode(<string>ret.pk),
      revision: ret.revision,
      data: base64urlDecode(<string>ret.data),
      signature: base64urlDecode(<string>ret.signature),
    } as SignedRegistryEntry;

    if (!verifyRegistryEntry(signedEntry)) {
      throwValidationError(
        "signedEntry", // name of the variable
        signedEntry, // actual value
        "result", // valueKind (assuming it's a function parameter)
        "a valid signed registry entry", // expected description
      );
    }

    return signedEntry;
  } catch (e) {
    if ((e as AxiosError).response?.status === 404) {
      return undefined;
    }

    throw e;
  }
}
