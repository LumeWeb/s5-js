import { CustomClientOptions, optionsToConfig } from "#utils/options.js";
import { S5Client } from "#client.js";
import { AccountPinsResponse, getS5AccountPins } from "#generated/index.js";

export async function accountPins(
  this: S5Client,
  customOptions: CustomClientOptions = {},
): Promise<AccountPinsResponse> {
  const opts = {
    ...this.clientOptions,
    ...customOptions,
    ...{
      endpointPath: "/s5/account/pins",
      baseUrl: await this.portalUrl,
    },
  };

  const config = optionsToConfig(this, opts);

  return await getS5AccountPins(config);
}
