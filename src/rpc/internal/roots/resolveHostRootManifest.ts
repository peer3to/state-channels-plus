import type { RootConstructor } from "../createRoot";
import { P2pRuntimeHostRoot, type HostContext } from "./P2pRuntimeHostRoot";
import type { SetupPayload } from "@/evm/p2pRuntime/types";
import {
    resolveManifestExport,
    type ModuleManifest
} from "@/utils/moduleLoader/resolveManifestExport";

/** Type-only key of the host root class a manifest names. */
declare const hostRootType: unique symbol;

/**
 * Where an application's {@link P2pRuntimeHostRoot} subclass lives. It crosses
 * the runtime port like the custom RPC manifest; `THost` is type-only and
 * types the client's host connection and application events.
 */
export type HostRootManifest<
    THost extends P2pRuntimeHostRoot = P2pRuntimeHostRoot
> = ModuleManifest & {
    /**
     * Type-only: never set at runtime. A method signature, so a manifest for a
     * root is accepted where a manifest for a related root is expected.
     */
    [hostRootType]?(host: THost): void;
};

export type HostRootConstructor<
    THost extends P2pRuntimeHostRoot = P2pRuntimeHostRoot
> = RootConstructor<THost, SetupPayload, HostContext>;

/** The host root class a manifest names, or the SDK's own without one. */
export async function resolveHostRootConstructor(
    manifest?: HostRootManifest
): Promise<HostRootConstructor> {
    if (!manifest) return P2pRuntimeHostRoot;
    return resolveManifestExport<HostRootConstructor>(
        manifest,
        "Host root",
        "host root class"
    );
}
