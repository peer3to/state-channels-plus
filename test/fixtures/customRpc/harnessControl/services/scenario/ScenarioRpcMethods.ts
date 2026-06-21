import ARpcMethods from "@/rpc/ARpcMethods";
import type ATransport from "@/transport/ATransport";
import type { ScenarioService } from "./ScenarioService";

/**
 * Host-side execution of a harness-supplied body. The only endpoint; the
 * accessor lives on {@link ScenarioService}.
 */
export class ScenarioRpcMethods extends ARpcMethods {
    constructor(
        transport: ATransport,
        private readonly service: ScenarioService
    ) {
        super(transport, service.p2pManager);
    }

    /**
     * Rebuild `(sm, args) => result` from source and run it with the live
     * stateManager. Returns its (serializable) result.
     */
    public async exec(
        fnBody: string,
        args: Record<string, unknown>
    ): Promise<unknown> {
        const fn = new Function(`return (${fnBody})`)() as (
            sm: typeof this.service.sm,
            args: Record<string, unknown>
        ) => unknown;
        return await fn(this.service.sm, args);
    }
}

export default ScenarioRpcMethods;
