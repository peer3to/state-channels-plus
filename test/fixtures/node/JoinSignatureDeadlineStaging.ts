// @spec-test-coverage-ignore: isolated chain-time staging for the exact join deadline boundary
import StateSnapshot from "@/models/StateSnapshot";
import { Codec, SignatureUtils, Type } from "@/utils";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import assert from "node:assert/strict";

export async function assertJoinSignatureDeadlineBoundary(
    h: MathPeerTestHarness
) {
    // The harness already owns and tears down a node when no URL is supplied.
    // Environment changes are confined to this test process and its startup.
    const providerUrl = process.env.PROVIDER_URL;
    const hardhatUrl = process.env.HARDHAT_NODE_URL;
    const managerCacheDir = process.env.E2E_MANAGER_CACHE_DIR;
    delete process.env.PROVIDER_URL;
    delete process.env.HARDHAT_NODE_URL;
    // Deployment markers belong to the shared chain, never this private node.
    delete process.env.E2E_MANAGER_CACHE_DIR;
    try {
        await h.lifecycle.start(2, 0);
    } finally {
        if (providerUrl === undefined) delete process.env.PROVIDER_URL;
        else process.env.PROVIDER_URL = providerUrl;
        if (hardhatUrl === undefined) delete process.env.HARDHAT_NODE_URL;
        else process.env.HARDHAT_NODE_URL = hardhatUrl;
        if (managerCacheDir === undefined)
            delete process.env.E2E_MANAGER_CACHE_DIR;
        else process.env.E2E_MANAGER_CACHE_DIR = managerCacheDir;
    }
    // Verify ownership before any node-wide mutation; never pause a shared slot.
    assert(Reflect.get(h, "ownNode"), "deadline test must own its chain node");
    const joiner = await h.join.addSpectatorWait();
    const snapshot = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    await h.provider.send("evm_setIntervalMining", [0]);
    try {
        const block = await h.provider.send("eth_getBlockByNumber", [
            "latest",
            false
        ]);
        const timestamp = Number(block.timestamp);
        // Let the responder's real provider observe the last mined block before
        // checking equality. No Clock implementation or response is replaced.
        await waitFor(
            async () =>
                (await h.execOnHost(
                    h.getPeer(0),
                    async (sm) =>
                        (await sm.stateChannelManagerContract.runner!.provider!.getBlock(
                            "latest"
                        ))!.timestamp
                )) === timestamp,
            h.event.protocolEventTimeoutMs()
        );
        const request = async (deadlineTimestamp: bigint) => {
            const signed = await SignatureUtils.signJoinChannel(
                {
                    participant: joiner.address,
                    channelId: h.channelId,
                    balance: { amount: 500n, data: "0x00" },
                    deadlineTimestamp
                },
                joiner.signer
            );
            const encodedRequest = String(
                Codec.encode(
                    {
                        encodedJoinChannel: String(signed.encoded),
                        signature: String(signed.signature)
                    },
                    Type.SignedJoinChannel
                )
            );
            const response = await h.execOnHost(
                h.getPeer(joiner.index),
                (sm, args) =>
                    sm.p2pManager.remoteRpc.joinChannelService
                        .requestJoinSignature(
                            args.encodedRequest,
                            args.snapshotHash,
                            args.forkId
                        )
                        .request(args.responder),
                {
                    encodedRequest,
                    snapshotHash: String(snapshot.hash),
                    forkId: String(snapshot.forkID),
                    responder: h.getPeer(0).address
                }
            );
            return SignatureUtils.getSignerAddress(
                String(signed.encoded),
                String(response.signature)
            );
        };
        expect(await request(BigInt(timestamp))).to.equal(h.getPeer(0).address);
        await assert.rejects(request(BigInt(timestamp - 1)), /join expired/);
    } finally {
        await h.provider.send("evm_setIntervalMining", [1000]);
    }
}
