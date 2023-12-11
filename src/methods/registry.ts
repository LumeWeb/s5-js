import { DEFAULT_BASE_OPTIONS } from "../utils/options.js";
import { CustomClientOptions, S5Client } from "../client.js";
import { ensureBytes } from "@noble/curves/abstract/utils";

import WS from "isomorphic-ws";
import { buildRequestUrl } from "#request.js";
import { Packer, SignedRegistryEntry } from "@lumeweb/libs5";
import { deserializeRegistryEntry } from "@lumeweb/libs5/lib/service/registry.js";
import { Buffer } from "buffer";
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

export type BaseCustomOptions = CustomClientOptions;

export type CustomRegistryOptions = BaseCustomOptions & {
  endpointSubscribeEntry?: string;
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
