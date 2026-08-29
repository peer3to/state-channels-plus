import ARpcService from "./ARpcService";

// Export the base class first to avoid CommonJS circular-dependency
// initialization issues (services import from "../../../rpc").
export { ARpcService };

import MainRpcService from "./MainRpcService";

export { MainRpcService };
export type { CustomRpcConstructor, CustomRpcManifest } from "./registry";
export { resolveCustomRpcConstructor } from "./resolveCustomRpcManifest";
export { default as ARpcRouter } from "./ARpcRouter";
export type { RpcRouterLike, RpcRequestOptions } from "./ARpcRouter";
export { default as PortRpcRouter } from "./PortRpcRouter";
export type { PortRpcRouterOptions } from "./PortRpcRouter";
export { WorkerLinks, realmWorkerLinks } from "./WorkerLinks";
export type { WorkerLink, WorkerLinkSide, LinkId } from "./WorkerLinks";
export type { RemoteRpcServices } from "./RemoteRpcProxy";
export { serializeError, deserializeError } from "./serializeError";
export type { SerializedError } from "./serializeError";
