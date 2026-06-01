// PeerWorker integration smoke: spawn, ready, dispose.

import { expect } from "chai";
import { describe, it } from "mocha";
import { ethers } from "ethers";

import { PeerWorker } from "../../PeerWorker";

const SMOKE_MODULE =
    "@test/harness/threaded/worker/__tests__/smokeDeploymentFixture";

const BASE_HARNESS_CONFIG = {
    timeConfig: {
        p2pTime: 1,
        agreementTime: 2,
        chainFallbackTime: 2,
        evidenceTime: 3
    },
    configOverrides: {},
    stateMachineGasLimit: 500_000,
    disputeExecutionGasLimit: 3_000_000
};

describe("PeerWorker boot smoke", () => {
    it("spawns a worker, completes boot phase, signals ready with peer address", async function () {
        this.timeout(90_000);

        const wallet = ethers.Wallet.createRandom();
        const peer = await PeerWorker.spawn({
            index: 0,
            signerPk: wallet.privateKey,
            channelId: "smoke-channel",
            discoveryRegistryPort: 0,
            channelManagerAddress: "0x0000000000000000000000000000000000000000",
            deploymentModule: SMOKE_MODULE,
            harnessConfig: BASE_HARNESS_CONFIG,
            logConfig: { level: "error" }
        });

        expect(peer.index).to.equal(0);
        expect(peer.peerAddress.toLowerCase()).to.equal(
            wallet.address.toLowerCase()
        );

        const result = await peer.dispose();
        expect(result.kind).to.equal("graceful");
    });

    it("crash during boot surfaces with phase + message", async function () {
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
                deploymentModule: "@test/harness/nonexistent-deployment-module",
                harnessConfig: BASE_HARNESS_CONFIG,
                logConfig: { level: "error" }
            });
        } catch (e) {
            caught = e as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(caught!.message).to.include("phase 'boot'");
    });
});
