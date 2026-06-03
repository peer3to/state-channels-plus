import type {
    TransitionInterface,
    NamedOpRequest
} from "../interfaces/TransitionInterface";
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";

export class WorkerTransitionHandle implements TransitionInterface {
    constructor(private readonly rpc: PeerCaller) {}

    submitNext(req: NamedOpRequest): Promise<unknown> {
        return this.rpc.call(req.op, req.args ?? {});
    }
}
