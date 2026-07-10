import { expect } from "chai";
import { Codec, Type } from "@/utils";
import Block from "@/models/Block";
import type { ForkId } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { covers } from "./domain";

// The state proof a dispute uploads is assembled by
// AgreementManager.getStateProof / tryBuildMilestone - driven here directly
// through query.buildStateProof on the peer's real storage. One test per
// stateProofAssembly field.

describe("dispute-upload / stateProofAssembly", function () {
    it(
        "two leavers across milestones → milestones-only proof with one finality milestone per change point",
        covers(
            {
                participantChangePoints: "two-plus"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.setupTwoLeaversAcrossMilestones();

                const { encodedStateProof } = await h
                    .control(h.getPeer(0))
                    .query.buildStateProof(h.activeForkId! as ForkId)
                    .request();
                const proof = Codec.decode(encodedStateProof, Type.StateProof);

                // two leave change points -> at least two finality milestones; the
                // milestone path leaves signedBlocks empty (getStateProof)
                expect(proof.signedBlocks.length).to.equal(0);
                expect(proof.milestones.length).to.be.gte(2);
            }
        )
    );

    it(
        "partially-signed tip → milestone threshold completed from an earlier block's signers (virtual voting)",
        covers(
            {
                signatureCollection: "virtual-voting"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();

                // the next writer authors a block whose broadcast is suppressed, then
                // an observer peer gets the author-only confirmation - the
                // deterministic mid-gossip state: the tip lacks the other
                // participants' signatures
                const author = (await h.query.getNextPeerToWrite()).index;
                const observer = author === 0 ? 1 : 0;
                h.byzantine.stubBroadcast(author);
                await h.transition.peerWrite({
                    peer: author,
                    waitForPeers: [author]
                });

                const forkId = h.activeForkId! as ForkId;
                const bundle = await h
                    .control(h.getPeer(author))
                    .query.getLatestBlockBundle(forkId)
                    .request();
                const encodedConfirmation = Codec.encode(
                    {
                        signedBlock: Codec.decode(
                            bundle!.encodedSignedBlock,
                            Type.SignedBlock
                        ),
                        signatures: []
                    },
                    Type.BlockConfirmation
                );
                await h
                    .control(h.getPeer(observer))
                    .transition.storeBlock(encodedConfirmation as string)
                    .request();

                const { encodedStateProof } = await h
                    .control(h.getPeer(observer))
                    .query.buildStateProof(forkId)
                    .request();
                const proof = Codec.decode(encodedStateProof, Type.StateProof);
                expect(proof.milestones.length).to.be.gte(1);
                const last = proof.milestones[proof.milestones.length - 1];

                // virtual voting observable: the author-only tip can't cover the
                // threshold alone - tryBuildMilestone collected the remaining
                // signers from the fully-signed previous block
                expect(last.blockConfirmations.length).to.be.gt(1);
            }
        )
    );

    it(
        "milestone at a leave change point still counts the leaver's signature toward its threshold",
        covers(
            {
                thresholdUnion: "with-leaver"
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.setupTwoLeaversAcrossMilestones();
                const leaver = h.getPeer(
                    h.context.leftChannelPeerIndices![0]
                ).address;

                const { encodedStateProof } = await h
                    .control(h.getPeer(0))
                    .query.buildStateProof(h.activeForkId! as ForkId)
                    .request();
                const proof = Codec.decode(encodedStateProof, Type.StateProof);

                // the threshold union (previous ∪ resulting participants) includes
                // the leaver for the milestone that removes it - so the leaver's
                // signature must appear among the proof's milestone signers
                const signers = new Set<string>();
                for (const milestone of proof.milestones) {
                    for (const bc of milestone.blockConfirmations) {
                        for (const addr of Block.fromBlockConfirmation(bc)
                            .allSignerAddresses) {
                            signers.add(String(addr).toLowerCase());
                        }
                    }
                }
                expect(
                    signers.has(leaver.toLowerCase()),
                    "leaver's signature must count toward the milestone that removed it"
                ).to.equal(true);
            }
        )
    );
});
