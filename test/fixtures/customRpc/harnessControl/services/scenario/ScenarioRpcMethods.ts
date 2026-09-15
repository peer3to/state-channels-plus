// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ScenarioService } from "./ScenarioService";
import * as eventBusModule from "@/events/EventBus";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import type NetworkTransport from "@/transport/NetworkTransport";
import { ethers } from "ethers";

/**
 * Modules handed to an exec body: `new Function` rebuilds the body without
 * module scope, so imports a test body needs must be injected explicitly.
 */
export type HostExecModules = {
    ethers: typeof ethers;
    eventBus: typeof eventBusModule;
};

/**
 * Host-side execution of a harness-supplied body. The only endpoint; the
 * accessor lives on {@link ScenarioService}.
 */
export class ScenarioRpcMethods extends ANetworkRpcMethods<ScenarioService> {
    constructor(transport: NetworkTransport, service: ScenarioService) {
        super(transport, service);
    }

    /**
     * Rebuild `(sm, args, modules) => result` from source and run it with the
     * live stateManager. Returns its (serializable) result.
     */
    public async exec(
        fnBody: string,
        args: Record<string, unknown>
    ): Promise<unknown> {
        const fn = new Function(`return (${fnBody})`)() as (
            sm: typeof this.service.sm,
            args: Record<string, unknown>,
            modules: HostExecModules
        ) => unknown;
        return await fn(this.service.sm, args, {
            ethers,
            eventBus: eventBusModule
        });
    }
}

export default ScenarioRpcMethods;
