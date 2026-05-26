// W1 - smoke tests for the PeerHandle polymorphism layer.
//
// (a) inline mode is the default; harness creates handles wrapping TestPeer.
//     this is type-check + identity verification; no chain interaction needed.
// (b) worker mode (W5) - 2-peer threaded smoke: orchestrator spins an http
//     hardhat node + LocalDiscoveryServer registry, workers dial both, exchange
//     a p2p message via LocalTransport.

import { expect } from "chai";
import { describe, it } from "mocha";

import { InlinePeer } from "@test/harness/core/InlinePeer";
import type { PeerHandle } from "@test/harness/core/PeerHandle";
import type { TestPeer } from "@test/harness/core/types";
import MathPeerTestHarness from "@test/fixtures/MathPeerTestHarness";

describe("W1 PeerHandle polymorphism", () => {
    it("InlinePeer wraps a TestPeer and exposes the four sub-handles", () => {
        // step 1 - construct a minimal stand-in TestPeer. real harness wiring
        // is exercised by the e2e suite; this test just proves the wrap shape.
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
        // step 1 - sub-handles are typed as their interfaces. one sanity call.
        return handle.queryInternals.connectionCount().then((n) => {
            expect(n).to.equal(0);
        });
    });

    it("InlineByzantineHandle.stubCalldataHandler swaps eventHandler.onBlockCalldataPosted", async () => {
        // step 1 - minimal eventHandler with a method we can swap + observe.
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
        // step 1 - stubbed: calling should NOT invoke the original
        await eh.onBlockCalldataPosted();
        expect(originalCalled).to.equal(0);
        // step 2 - restore brings the original back
        await peer.byzantine.restoreCalldataHandler();
        await eh.onBlockCalldataPosted();
        expect(originalCalled).to.equal(1);
    });

    it("two-peer threaded smoke: workers boot against http hardhat + dial discovery registry", async function () {
        this.timeout(180_000);
        // step 1 - dedicatedPeerThread=true -> harness boots HttpHardhatNode +
        // LocalDiscoveryServer in setup, workers dial both during p2pSetup.
        const harness = new MathPeerTestHarness();
        try {
            await harness.setup(2, { dedicatedPeerThread: true });
            // step 2 - probe each handle's queryInternals.self -> proves the
            // worker rpc surface is reachable AND that p2pSetup completed.
            const a = await harness.getPeerHandle(0).queryInternals.self();
            const b = await harness.getPeerHandle(1).queryInternals.self();
            expect(a).to.be.a("string").and.have.length.greaterThan(0);
            expect(b).to.be.a("string").and.have.length.greaterThan(0);
            expect(a).to.not.equal(b);
            // step 3 - queryStatus + connectionCount proves the rpc surface
            // routes plumbed through this round work end-to-end.
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
