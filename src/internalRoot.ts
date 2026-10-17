// The internal RPC root API alone. A worker that runs only its own services
// (such as a crypto worker) imports this entry instead of the package index,
// so it never loads the P2P runtime, its relay, and their WASM instances.
export {
    AInternalRpcRoot,
    type RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
export { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
export { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
export {
    startRootWorker,
    type RootStartContext
} from "@/rpc/internal/createRoot";
export type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
export type { default as InternalTransport } from "@/transport/InternalTransport";
export type { Logger } from "@/utils/logging/Logger";
