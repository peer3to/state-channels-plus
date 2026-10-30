// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { HostProbeService } from "./probe/HostProbeService";
import type { ProbeRpc } from "./ProbeRpc";
import { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";

/**
 * A test application's host root: one internal probe service over the
 * application's network root, loaded by a host root manifest.
 */
export class ProbeHostRoot extends P2pRuntimeHostRoot<ProbeRpc> {
    public readonly probe = new HostProbeService(
        this.router,
        () => this.application
    );
}

/** A function but not a class: a manifest naming it must reject setup. */
export const NOT_A_HOST_ROOT = () => "not a host root class";
