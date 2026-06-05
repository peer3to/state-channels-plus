import {
    createWorkerHostTransport,
    type GossipInitMessage
} from "@platform/workerTransport";
import { ContractExecutorWorkerHost } from "../ContractExecutorWorkerHostCore";

// First inbound message carries the transferred gossip port; build the host from it.
globalThis.onmessage = (event: MessageEvent<GossipInitMessage>) => {
    const init = event.data;
    if (!init || init.__gossipInit !== true) {
        throw new Error("Contract executor worker host expected gossip init");
    }
    new ContractExecutorWorkerHost(createWorkerHostTransport(init.port));
};
