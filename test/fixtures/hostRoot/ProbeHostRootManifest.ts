// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ProbeHostRoot } from "./ProbeHostRoot";
import type { HostRootManifest } from "@/rpc/internal/roots/resolveHostRootManifest";
import type { CustomRpcManifest } from "@/rpc/network/registry";
import path from "node:path";

/** The probe host root module; the loader runs its `.ts` or `.js` twin. */
export const PROBE_HOST_ROOT_MODULE = path.resolve(
    __dirname,
    "ProbeHostRoot.ts"
);

export function probeHostRootManifest(): HostRootManifest<ProbeHostRoot> {
    return { module: PROBE_HOST_ROOT_MODULE, exportName: "ProbeHostRoot" };
}

/** Names an export of the probe module that is a function but not a class. */
export function nonClassHostRootManifest(): HostRootManifest {
    return { module: PROBE_HOST_ROOT_MODULE, exportName: "NOT_A_HOST_ROOT" };
}

/** The test application's network root, which emits the declared events. */
export function probeRpcManifest(): CustomRpcManifest {
    return {
        module: path.resolve(__dirname, "ProbeRpc.ts"),
        exportName: "ProbeRpc"
    };
}
