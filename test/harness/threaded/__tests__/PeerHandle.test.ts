// PeerHandle polymorphism smoke tests: inline wrap shape and threaded worker mode.

import { expect } from "chai";
import { describe, it } from "mocha";

import { InlinePeer } from "@test/harness/core/InlinePeer";
import type { PeerHandle } from "@test/harness/core/PeerHandle";
import type { TestPeer } from "@test/harness/core/types";

import MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";

describe("PeerHandle polymorphism", () => {
    it("InlinePeer wraps a TestPeer and exposes the four sub-handles", () => {
        const stand: Partial<TestPeer> = {
            index: 7,
            address: "0xdeadbeef",
            signer: {} as never,
            logger: {} as never,
            eventSpies: {},
            turnBarrier: {} as never,
            stateManager: {
                forkId: undefined,
                getStatus: () => "ok",
                storage: { blocks: { getLatestBlock: () => undefined } },
                p2pManager: { openConnections: [] }
            } as never,
            p2pInstance: { dispose: async () => undefined } as never
        };
        const handle: PeerHandle = new InlinePeer(stand as TestPeer);
        expect(handle.index).to.equal(7);
        expect(handle.address).to.equal("0xdeadbeef");
        expect(handle.byzantine).to.exist;
        expect(handle.rpcStub).to.exist;
        expect(handle.queryInternals).to.exist;
        expect(handle.network).to.exist;
        return handle.queryInternals.connectionCount().then((n) => {
            expect(n).to.equal(0);
        });
    });

    it("InlineByzantineHandle.stubCalldataHandler swaps eventHandler.onBlockCalldataPosted", async () => {
        let originalCalled = 0;
        const original = async () => {
            originalCalled += 1;
        };
        const eh: { onBlockCalldataPosted: () => Promise<void> } = {
            onBlockCalldataPosted: original
        };
        const stand: Partial<TestPeer> = {
            index: 0,
            address: "0x",
            signer: {} as never,
            logger: {} as never,
            eventSpies: {},
            turnBarrier: {} as never,
            stateManager: { eventHandler: eh } as never,
            p2pInstance: { dispose: async () => undefined } as never
        };
        const peer = new InlinePeer(stand as TestPeer);
        await peer.byzantine.stubCalldataHandler();
        await eh.onBlockCalldataPosted();
        expect(originalCalled).to.equal(0);
        await peer.byzantine.restoreCalldataHandler();
        await eh.onBlockCalldataPosted();
        expect(originalCalled).to.equal(1);
    });

    it("two-peer threaded smoke: workers boot against http hardhat + dial discovery registry", async function () {
        this.timeout(180_000);
        const harness = new MathPeerTestHarness();
        try {
            await harness.setup(2, { dedicatedPeerThread: true });
            const a = await harness.getPeerHandle(0).queryInternals.self();
            const b = await harness.getPeerHandle(1).queryInternals.self();
            expect(a).to.be.a("string").and.have.length.greaterThan(0);
            expect(b).to.be.a("string").and.have.length.greaterThan(0);
            expect(a).to.not.equal(b);
            const status0 = await harness.getPeerHandle(0).queryStatus();
            expect(status0).to.not.be.undefined;
            const conns0 = await harness
                .getPeerHandle(0)
                .queryInternals.connectionCount();
            expect(conns0).to.be.a("number");
        } finally {
            await harness.cleanup();
        }
    });
});
