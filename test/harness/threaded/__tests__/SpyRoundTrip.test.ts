// W4 - spy round-trip acceptance. boots a real Worker via PeerWorker.spawn,
// drives a test-only bump via the spy.testBump handler, asserts the
// orchestrator-side SpyMirror sees the count + lastArgs.
//
// real bumps come from the event-handler proxy once p2pSetup lands (W5).
// for now the bump path is exercised directly via rpc.

import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "ethers";

import { PeerWorker } from "../PeerWorker";
import { SpyMirror, makeWorkerEventSpy } from "@test/harness/core/SpyMirror";
import { EventBarrier, createLogger } from "@/utils";
import { SMOKE_DEPLOYMENT_KEY } from "../worker/__tests__/smokeDeploymentFixture";

const SMOKE_BUNDLE =
    "@test/harness/threaded/worker/__tests__/smokeDeploymentFixture";

describe("W4 spy round-trip", () => {
    it("worker bump -> orchestrator mirror updates count + lastArgs", async function () {
        this.timeout(90_000);

        const wallet = ethers.Wallet.createRandom();
        const peer = await PeerWorker.spawn({
            index: 3,
            signerPk: wallet.privateKey,
            channelId: "spy-roundtrip",
            discoveryRegistryPort: 0,
            channelManagerAddress: "0x0000000000000000000000000000000000000000",
            deploymentName: SMOKE_DEPLOYMENT_KEY,
            bundleManifest: [SMOKE_BUNDLE],
            harnessConfig: {
                timeConfig: {
                    p2pTime: 1,
                    agreementTime: 2,
                    chainFallbackTime: 2,
                    evidenceTime: 3
                },
                configOverrides: {},
                stateMachineGasLimit: 500_000,
                disputeExecutionGasLimit: 3_000_000,
                channelId: "spy-roundtrip",
                initialBalance: 500
            },
            logConfig: { level: "error", peerIndex: 3 },
            testTitle: "W4 spy round-trip"
        });

        // step 1 - wire orchestrator-side mirror. signal -> existing harness
        // barrier (here a standalone instance; harness-level wiring lands in W1).
        const barrier = new EventBarrier(createLogger());
        const mirror = new SpyMirror(barrier);
        const rpc = peer.getRpcClient();
        rpc.on("spy", (payload: unknown) => {
            mirror.ingest(payload as Parameters<SpyMirror["ingest"]>[0]);
        });

        // step 1 - drive a bump from the orchestrator side via the test-only
        // rpc. real bumps come from the worker's event-handler proxy (W5).
        await rpc.call("spy.testBump", {
            name: "onTurn",
            eventArgs: ["0xdeadbeef"]
        });

        // step 1 - one extra setImmediate to drain the push frame
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        expect(mirror.getCount(3, "onTurn")).to.equal(1);
        const args = mirror.getLastArgs(3, "onTurn");
        expect(args).to.deep.equal(["0xdeadbeef"]);

        // step 1 - WorkerEventSpy reflects mirror state.
        const spy = makeWorkerEventSpy(mirror, 3, "onTurn");
        expect(spy.callCount).to.equal(1);
        expect(spy.lastCall?.args).to.deep.equal(["0xdeadbeef"]);

        // step 1 - second bump bumps count and overwrites lastArgs.
        await rpc.call("spy.testBump", {
            name: "onTurn",
            eventArgs: [42]
        });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        expect(spy.callCount).to.equal(2);
        expect(spy.lastCall?.args).to.deep.equal([42]);

        // step 1 - reset clears via spy.reset rpc + mirror.noteReset.
        await rpc.call("spy.reset", {});
        mirror.noteReset(3);
        expect(spy.callCount).to.equal(0);
        expect(spy.lastCall).to.equal(undefined);

        // step 1 - getCalls throws by design (D-14).
        expect(() => spy.getCalls()).to.throw(/inline-only/);

        await peer.dispose();
    });
});
