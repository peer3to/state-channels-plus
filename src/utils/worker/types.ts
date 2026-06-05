import type { Neighbour } from "@/utils/GossipNode";

// Directed request/response framing, generic over the consumer's payload.
export type WorkerEnvelope<TPayload> = { requestId: number; payload: TPayload };

export type SerializedError = {
    message: string;
    name?: string;
    stack?: string;
    data?: string;
};

export type WorkerResult<TResult> =
    | { type: "ready" }
    | { requestId: number; ok: true; result: TResult }
    | { requestId: number; ok: false; error: SerializedError };

// The two seams the @platform layer provides. `gossipNeighbour` is the dedicated
// gossip port; post/onMessage are the directed RPC pipe.
export type WorkerClientTransport = {
    post: (envelope: WorkerEnvelope<unknown>) => void;
    onMessage: (handler: (result: WorkerResult<unknown>) => void) => void;
    onError: (handler: (error: Error) => void) => void;
    terminate: () => Promise<unknown> | unknown;
    gossipNeighbour: Neighbour;
};

// The host is terminated from the client side (WorkerClientTransport.terminate), so
// the host transport intentionally has no `terminate`.
export type WorkerHostTransport = {
    post: (result: WorkerResult<unknown>) => void;
    onMessage: (handler: (envelope: WorkerEnvelope<unknown>) => void) => void;
    gossipNeighbour: Neighbour;
};
