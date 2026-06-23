import { expect } from "chai";

import {
    RpcQueue,
    MAX_PREAUTH_QUEUED_RPCS
} from "@/rpc/guards/HandshakeCompletedGuard";
import type Rpc from "@/rpc/Rpc";

/**
 * Regression: the per-transport queue that buffers guarded RPCs during handshake
 * negotiation must be bounded, so an unauthenticated peer cannot grow it without
 * limit. enqueue returns false on overflow; the guard treats that as abuse.
 */
const makeRpc = (overrides: Partial<Rpc> = {}): Rpc => ({
    service: "s",
    method: "m",
    params: [],
    ...overrides
});

describe("RpcQueue - pre-handshake buffering bounds", function () {
    it("accepts up to the count limit, then rejects", function () {
        const queue = new RpcQueue(2, 1_000_000);

        expect(queue.enqueue(makeRpc())).to.equal(true);
        expect(queue.enqueue(makeRpc())).to.equal(true);
        expect(queue.enqueue(makeRpc())).to.equal(false);
    });

    it("rejects once the byte budget is exceeded", function () {
        // Each makeRpc() serializes to well under 100 bytes; a tiny budget admits
        // one then rejects the next.
        const queue = new RpcQueue(100, 60);

        expect(queue.enqueue(makeRpc())).to.equal(true);
        expect(queue.enqueue(makeRpc())).to.equal(false);
    });

    it("frees capacity after clear()", function () {
        const queue = new RpcQueue(1, 1_000_000);

        expect(queue.enqueue(makeRpc())).to.equal(true);
        expect(queue.enqueue(makeRpc())).to.equal(false);

        queue.clear();
        expect(queue.enqueue(makeRpc())).to.equal(true);
    });

    it("frees capacity (count and bytes) after drain()", function () {
        const queue = new RpcQueue(1, 1_000_000);
        expect(queue.enqueue(makeRpc())).to.equal(true);

        const drained: Rpc[] = [];
        queue.drain((rpc) => drained.push(rpc));
        expect(drained.length).to.equal(1);

        // Byte counter reset too, so the next enqueue is admitted.
        expect(queue.enqueue(makeRpc())).to.equal(true);
    });

    it("defaults to a sane count bound", function () {
        const queue = new RpcQueue();
        for (let i = 0; i < MAX_PREAUTH_QUEUED_RPCS; i++) {
            expect(queue.enqueue(makeRpc())).to.equal(true);
        }
        expect(queue.enqueue(makeRpc())).to.equal(false);
    });
});
