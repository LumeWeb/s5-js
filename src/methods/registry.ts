import { DEFAULT_BASE_OPTIONS } from "../utils/options.js";
import { CustomClientOptions, S5Client } from "../client.js";
import { ensureBytes, equalBytes } from "@noble/curves/abstract/utils";

import WS from "isomorphic-ws";
import { buildRequestUrl, ExecuteRequestError } from "#request.js";
import {
  CID,
  createKeyPair,
  KeyPairEd25519,
  Packer,
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

export const DEFAULT_GET_ENTRY_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointGetEntry: "/s5/registry",
};

export const DEFAULT_SET_ENTRY_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointSetEntry: "/s5/registry",
  deleteForever: false,
};

export const DEFAULT_SUBSCRIBE_ENTRY_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointSubscribeEntry: "/s5/registry/subscription",
};

export const DEFAULT_PUBLISH_ENTRY_OPTIONS = {
  ...DEFAULT_BASE_OPTIONS,
  endpointPublishEntry: "/s5/registry",
};

export type BaseCustomOptions = CustomClientOptions;

export type CustomRegistryOptions = BaseCustomOptions & {
  endpointSubscribeEntry?: string;
  endpointPublishEntry?: string;
};

export async function subscribeToEntry(
  this: S5Client,
  publicKey: Uint8Array,
  customOptions?: CustomRegistryOptions,
) {
  const opts = {
    ...DEFAULT_SUBSCRIBE_ENTRY_OPTIONS,
    ...this.customOptions,
    ...customOptions,
  };

  publicKey = ensureBytes("public key", publicKey, 32);

  const url = await buildRequestUrl(this, {
    baseUrl: await this.portalUrl(),
    endpointPath: opts.endpointSubscribeEntry,
  });

  const socket = new WS(url);

  socket.once("open", () => {
    const packer = new Packer();
    packer.pack(2);
    packer.pack(publicKey);

    socket.send(packer.takeBytes());
  });

  return {
    listen(cb: (entry: SignedRegistryEntry) => void) {
      socket.on("message", (data) => {
        cb(deserializeRegistryEntry(new Uint8Array(data as Buffer)));
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
  customOptions?: CustomRegistryOptions,
) {
  const opts = {
    ...DEFAULT_PUBLISH_ENTRY_OPTIONS,
    ...this.customOptions,
    ...customOptions,
  };

  if (!verifyRegistryEntry(signedEntry)) {
    throwValidationError(
      "signedEntry", // name of the variable
      signedEntry, // actual value
      "parameter", // valueKind (assuming it's a function parameter)
      "a valid signed registry entry", // expected description
    );
  }

  return await this.executeRequest({
    ...opts,
    endpointPath: opts.endpointPublishEntry,
    method: "post",
    data: {
      pk: base64urlEncode(signedEntry.pk),
      revision: signedEntry.revision,
      data: base64urlEncode(signedEntry.data),
      signature: base64urlEncode(signedEntry.signature),
    },
  });
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

  let entry = await this.getEntry(sk.publicKey);

  if (!entry) {
    entry = {
      pk: sk,
      data: cid.toRegistryEntry(),
      revision,
    } as unknown as SignedRegistryEntry;
  } else {
    if (!equalBytes(sk.publicKey, entry.pk)) {
      throwValidationError(
        "entry.pk", // name of the variable
        Buffer.from(entry.pk).toString("hex"), // actual value
        "result", // valueKind (assuming it's a function parameter)
        Buffer.from(sk.publicKey).toString("hex"), // expected description
      );
    }

    entry.revision++;
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
  customOptions?: CustomRegistryOptions,
) {
  const opts = {
    ...DEFAULT_GET_ENTRY_OPTIONS,
    ...this.customOptions,
    ...customOptions,
  };

  try {
    const ret = await this.executeRequest({
      ...opts,
      endpointPath: opts.endpointGetEntry,
      method: "get",
      data: {
        pk: base64urlEncode(publicKey),
      },
    });

    const signedEntry = {
      pk: base64urlDecode(ret.data.pk),
      revision: ret.data.revision,
      data: base64urlDecode(ret.data.data),
      signature: base64urlDecode(ret.data.signature),
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
    if ((e as ExecuteRequestError).responseStatus === 404) {
      return undefined;
    }

    throw e;
  }
}
