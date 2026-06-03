import { ethers } from "ethers";
import { MathTestSession as TestSession } from "@test/harness";

// Specific protocol-gap regression: an attacker authors a block H beyond the honest
// peers' tip and suppresses its broadcast, then files a self-removal dispute whose
// stateProof references the un-broadcast block. Honest peers must NOT fast-forward
// their local fork to incorporate that block just because they see it inside a
// dispute commitment — otherwise the attacker can move state forward unilaterally.

describe("E2E: dispute validation / futureBlock", function () {
    it("dispute.input.stateProof references block above honest peers' tip → dispute commits but honest peers stay at their pre-dispute height", async function () {
        const h = TestSession.getHarness();

        await h.lifecycle.start(4, 3, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 6,
                chainFallbackTime: 2,
                evidenceTime: 6
            }
        });

        const forkId = h.activeForkId!;

        // Suppress peer 3's outbound block broadcast
        await h.byzantine.stubBroadcast(3);
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 3 });

        await h.transition.peerWrite({ peer: 3, waitForPeers: [3] });

        // Verify the asymmetric storage state: peer 3 has block 3,
        // honest peers still at block 2.
        const peer3Latest = await h
            .getPeerHandle(3)
            .blocks.queryLatestBlock(forkId);
        if (!peer3Latest || peer3Latest.height !== 3) {
            throw new Error(
                `expected peer 3 to have height 3 after suppressed write, got ${peer3Latest?.height}`
            );
        }
        for (const honestIndex of [0, 1, 2]) {
            const honestLatest = await h
                .getPeerHandle(honestIndex)
                .blocks.queryLatestBlock(forkId);
            if (honestLatest && (honestLatest.height ?? 0) > 2) {
                throw new Error(
                    `expected honest peer ${honestIndex} at height == 2, got ${honestLatest.height} (broadcast suppression failed)`
                );
            }
        }
        h.event.resetEventSpies();

        // Peer 3 files a self-removal dispute. the lastest block in the state proof is block 3.
        await h.tamper.postTamperedDispute(3, (dispute) => {
            dispute.input.timeout.participant = ethers.ZeroAddress;
            dispute.input.onChainSlashes = [];
            dispute.input.selfRemoval = true;
        });

        // confirm the latest block in the state proof is block 3
        const tampered = h.context.tamperedDisputes.at(-1)!;
        const { hasBlock, latestBlock: latest } = await h
            .localDiamondView(0)
            .getLatestBlockFromStateProof(tampered.input.stateProof);
        if (
            !hasBlock ||
            Number(latest.transaction.header.transactionCnt) !== 3
        ) {
            throw new Error(
                `dispute state proof must reference block 3 (got hasBlock=${hasBlock}, height=${
                    hasBlock
                        ? Number(latest.transaction.header.transactionCnt)
                        : "n/a"
                })`
            );
        }

        await h.assert.dispute.committedWait({
            peersIndices: [0, 1, 2],
            expectedCount: 1,
            timeoutMs: 10000
        });

        // confirm other peers did not modify their local state forward, their tip is at block height 2
        for (const honestIndex of [0, 1, 2]) {
            const latestBlock = await h
                .getPeerHandle(honestIndex)
                .blocks.queryLatestBlock(forkId);
            if (!latestBlock) {
                throw new Error(
                    `peer ${honestIndex} has no latest block on the original fork`
                );
            }
            if ((latestBlock.height ?? 0) > 2) {
                throw new Error(
                    `peer ${honestIndex} fast-forwarded on original fork: height ${latestBlock.height} > 2 -> height-above attack succeeded (PROTOCOL GAP)`
                );
            }
        }

        await h.dispute.resolveDisputeWait({
            assertMaliciousRemoved: false
        });
    });
});
