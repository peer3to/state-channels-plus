import ANetworkRpcService from "./network/ANetworkRpcService";

// Export the base class first to avoid CommonJS circular-dependency
// initialization issues when custom services import the public RPC barrel.
export { ANetworkRpcService };

import MainRpcService from "./network/MainRpcService";

export { MainRpcService };
export type {
    CustomRpcConstructor,
    CustomRpcManifest
} from "./network/registry";
export { resolveCustomRpcConstructor } from "./network/resolveCustomRpcManifest";
