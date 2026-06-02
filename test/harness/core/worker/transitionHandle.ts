import type {
    TransitionInterface,
    NamedOpRequest
} from "../interfaces/TransitionInterface";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";
import { rejectLambdaArgs } from "../namedOpGuards";

export class WorkerTransitionHandle implements TransitionInterface {
    constructor(private readonly rpc: PeerCaller) {}

    submitNext(req: NamedOpRequest): Promise<unknown> {
        rejectLambdaArgs("WorkerPeer.transition.submitNext", req);
        return this.rpc.call(req.op, req.args ?? {});
    }
}
