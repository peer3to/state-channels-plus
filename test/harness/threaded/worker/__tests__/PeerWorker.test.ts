// W2 - integration smoke. spawn a real Worker, await ready (boot phase),
// call lifecycle.dispose, verify clean exit. proves W3 + W2 wiring end-to-end
// without requiring W5 chain access.

import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "ethers";

import { PeerWorker } from "../../PeerWorker";
// step 1 - side-effect import. registers SMOKE_DEPLOYMENT_KEY on the
// orchestrator side. the worker imports the same path via bundleManifest
// (W2 §4.5) so registration runs on its isolate too.
import { SMOKE_DEPLOYMENT_KEY } from "./smokeDeploymentFixture";

// step 1 - path the worker resolves at boot. relative to the worker entry.
const SMOKE_BUNDLE =
    "@test/harness/threaded/worker/__tests__/smokeDeploymentFixture";

describe("PeerWorker (W2) - boot smoke", () => {
    it("spawns a worker, completes boot phase, signals ready with peer address", async function () {
        // step 1 - ts-node cold compile dominates; give a generous timeout
        this.timeout(90_000);

        const wallet = ethers.Wallet.createRandom();
        const peer = await PeerWorker.spawn({
            index: 0,
            signerPk: wallet.privateKey,
            channelId: "smoke-channel",
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
                channelId: "smoke-channel",
                initialBalance: 500
            },
            logConfig: { level: "error", peerIndex: 0 },
            testTitle: "PeerWorker boot smoke"
        });

        expect(peer.index).to.equal(0);
        expect(peer.peerAddress.toLowerCase()).to.equal(
            wallet.address.toLowerCase()
        );

        const result = await peer.dispose();
        expect(result.kind).to.equal("graceful");
    });

    it("throws UnsupportedInWorkerMode when customPrecompiles non-empty", async function () {
        this.timeout(5_000);
        const wallet = ethers.Wallet.createRandom();
        let caught: Error | undefined;
        try {
            await PeerWorker.spawn({
                index: 0,
                signerPk: wallet.privateKey,
                channelId: "x",
                discoveryRegistryPort: 0,
                channelManagerAddress: "0x0",
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
                    channelId: "x",
                    initialBalance: 500
                },
                logConfig: { level: "error", peerIndex: 0 },
                testTitle: "unsupported",
                customPrecompilesNonEmpty: true
            });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught?.name).to.equal("UnsupportedInWorkerMode");
        expect(caught?.message).to.include("customPrecompiles");
    });

    it("crash during boot surfaces with phase + name", async function () {
        this.timeout(90_000);
        const wallet = ethers.Wallet.createRandom();
        let caught: Error | undefined;
        try {
            await PeerWorker.spawn({
                index: 0,
                signerPk: wallet.privateKey,
                channelId: "x",
                discoveryRegistryPort: 0,
                channelManagerAddress: "0x0",
                // step 1 - deploymentName not registered -> resolveDeployment throws
                deploymentName: "nonexistent-deployment-name",
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
                    channelId: "x",
                    initialBalance: 500
                },
                logConfig: { level: "error", peerIndex: 0 },
                testTitle: "crash smoke"
            });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include("phase 'boot'");
        expect(caught!.message).to.include("nonexistent-deployment-name");
    });
});
