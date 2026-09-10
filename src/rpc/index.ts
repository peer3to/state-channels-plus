import ARpcService from "./ARpcService";

// Export the base class first to avoid CommonJS circular-dependency
// initialization issues (services import from "../../../rpc").
export { ARpcService };

import MainRpcService from "./MainRpcService";

export { MainRpcService };
export type { CustomRpcConstructor, CustomRpcManifest } from "./registry";
export { resolveCustomRpcConstructor } from "./resolveCustomRpcManifest";
export { default as RpcRouter } from "./RpcRouter";
export type { RpcRouterOptions, RpcRequestOptions } from "./RpcRouter";
export type { RemoteRpcServices } from "./RemoteRpcProxy";
export { serializeError, deserializeError } from "./serializeError";
export type { SerializedError } from "./serializeError";
