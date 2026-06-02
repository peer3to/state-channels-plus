import type {
    TransitionInterface,
    NamedOpRequest
} from "../interfaces/TransitionInterface";
import type { TestPeer } from "../types";

export class InlineTransitionHandle implements TransitionInterface {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private readonly _peer: TestPeer) {}

    async submitNext(_req: NamedOpRequest): Promise<unknown> {
        throw new Error(
            "InlinePeer.transition.submitNext is not available in inline mode. " +
                "Use action class methods (e.g. h.transition.increment()) which " +
                "call the contract instance directly."
        );
    }
}
