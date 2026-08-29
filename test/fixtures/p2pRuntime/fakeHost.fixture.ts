// @spec-test-coverage-ignore: fake runtime host staging shared by the client suites; the suites own the declarations
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { SerializedError } from "@/rpc/serializeError";

export type FakeHostReply =
    | { ok: true; result: unknown }
    | { ok: false; error: SerializedError };

/**
 * a host on the far port that answers by name: `answers` decides one call,
 * every other request is answered ok at once, and a cast is ignored. returns
 * a way to post a frame of its own (a push) and the requests it saw.
 */
export function fakeHost(
    port: RuntimePort,
    answers: (rpc: Rpc) => FakeHostReply | "hold" | undefined
): {
    seen: Rpc[];
    push: (frame: Rpc) => void;
    reply: (requestId: string, reply: FakeHostReply) => void;
} {
    const seen: Rpc[] = [];
    const reply = (requestId: string, outcome: FakeHostReply) => {
        port.post({
            rpcResponse: true,
            requestId,
            ...outcome
        } satisfies RpcResponse);
    };
    port.onMessage((raw) => {
        const rpc = raw as Rpc;
        if (!("service" in rpc)) return;
        seen.push(rpc);
        if (rpc.requestId === undefined) return;
        const outcome = answers(rpc) ?? { ok: true, result: undefined };
        if (outcome === "hold") return;
        reply(rpc.requestId, outcome);
    });
    port.start();
    return { seen, push: (frame) => port.post(frame), reply };
}
