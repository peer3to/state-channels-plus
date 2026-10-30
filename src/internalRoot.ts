// First: it counts every WebAssembly instance this thread creates after it.
import "@/utils/threadResources";
// The internal RPC root API, for a worker that runs only its own services
// (such as a crypto worker). Unlike the package index it never loads the P2P
// runtime host, its relay, or their WASM instances; it still loads the channel
// models, storage, and contract ABIs that logging uses. The index re-exports
// this list, so the two entries cannot drift apart.
export {
    AInternalRpcRoot,
    type RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
export { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
export { AInternalRpcMethods } from "@/rpc/internal/AInternalRpcMethods";
export {
    createRoot,
    startRootWorker,
    type RootConstructor,
    type RootStartContext
} from "@/rpc/internal/createRoot";
export type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
export type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
export type { default as InternalTransport } from "@/transport/InternalTransport";
export type { Logger } from "@/utils/logging/Logger";
