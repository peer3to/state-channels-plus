import type {
    TransitionInterface,
    NamedOpRequest
} from "../interfaces/TransitionInterface";
import type { TestPeer } from "../types";

type ContractMethods = Record<
    string,
    ((...a: unknown[]) => Promise<unknown>) | undefined
>;

export class InlineTransitionHandle implements TransitionInterface {
    constructor(private readonly peer: TestPeer) {}

    async submitNext(req: NamedOpRequest): Promise<unknown> {
        const method = req.op.split(".").pop()!;
        const contract = this.peer.p2pInstance
            .p2pContractInstance as unknown as ContractMethods;
        const fn = contract[method];
        if (typeof fn !== "function")
            throw new Error(`InlineTransitionHandle: no method '${req.op}'`);
        const args = req.args as { value?: unknown } | undefined;
        return fn.call(
            contract,
            ...(args && "value" in args ? [args.value] : [])
        );
    }
}
