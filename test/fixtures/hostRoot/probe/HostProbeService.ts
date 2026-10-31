// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { HostProbeRpcMethods } from "./HostProbeRpcMethods";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type InternalTransport from "@/transport/InternalTransport";
import type { ProbeRpc } from "@test/fixtures/hostRoot/ProbeRpc";

/** What `echo` returns: the value and the runtime's signer address. */
export type ProbeEcho = { value: string; signerAddress: string };

/** Internal probe service of the test application's host root. */
export class HostProbeService extends AInternalRpcService<HostProbeRpcMethods> {
    /** Values `echo` served, in call order. */
    public readonly echoes: string[] = [];

    constructor(
        router: InternalRpcRouter,
        public readonly application: () => ProbeRpc
    ) {
        super(router);
    }

    public createRPCMethods(sender: InternalTransport) {
        return new HostProbeRpcMethods(this, sender);
    }
}
