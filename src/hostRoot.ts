// First: it counts every WebAssembly instance this thread creates after it.
import "@/utils/threadResources";
// The P2P runtime host root API, for an application's host root that extends
// it with its own services. Unlike the package index it never loads the EVM
// factory or the rest of the EVM layer: the host root runs the contract
// executor in its own worker. The index re-exports this list, so the two
// entries cannot drift apart.
export {
    P2pRuntimeHostRoot,
    type ApplicationOf,
    type HostEventsOf
} from "@/rpc/internal/roots/P2pRuntimeHostRoot";
export type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
