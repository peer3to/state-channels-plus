// @spec-test-coverage-ignore: genuine inbound consumed and pruned by a same-fork snapshot, shared by the unit and E2E declarations
import type { Address, ForkId } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

/** a top-up lands, honest blocks consume it, then a posted snapshot prunes it and its ancestors on chain */
export async function stagePrunedGenuineInbound() {
    const h = TestSession.getHarness();
    await h.lifecycle.start(3, 1);
    const observer = h.getPeer(1);
    await h.join.forceInboundJoinWait({ participant: h.getPeer(0).address });
    const prunedHash = await h
        .control(observer)
        .query.getLatestInboundMessageHash()
        .request();
    expect(prunedHash, "top-up stored").to.not.equal(null);
    const prunedInbound: MessageBlockStruct = Codec.decode(
        (await h
            .control(observer)
            .query.getInboundMessageBlock(prunedHash!)
            .request())!.encodedMessageBlock,
        Type.MessageBlock
    );

    await h.transition.advanceState({ count: 2, waitForFinalization: true });
    await h.transition.postSnapshotWait();

    // premise - the posted snapshot consumed the top-up -> same-fork adoption pruned it
    const snapshot = await h.channelManager.getStateSnapshot(h.channelId);
    expect(snapshot.snapshotData.latestInboundMessageBlockHash).to.equal(
        prunedHash
    );
    const snapshotInboundHeight = Number(
        snapshot.snapshotData.latestInboundMessageBlockHeight
    );
    expect(Number(prunedInbound.blockHeight)).to.equal(snapshotInboundHeight);
    const forkId = h.activeForkId!;
    return {
        prunedInbound,
        snapshotInboundHeight,
        forkId,
        carrier: await findCarrier(forkId, String(prunedHash))
    };
}

/** the honest signed block that consumed the inbound block `inboundHash` */
async function findCarrier(forkId: ForkId, inboundHash: string) {
    const h = TestSession.getHarness();
    const observer = h.getPeer(1);
    const latest = await h
        .control(observer)
        .query.getLatestBlockHeight(forkId)
        .request();
    for (let height = 0; height <= latest!; height++) {
        const bundle = await h
            .control(observer)
            .query.getBlockByHeight(forkId, height)
            .request();
        const signedBlock = Codec.decode(
            bundle!.encodedSignedBlock,
            Type.SignedBlock
        );
        const block = Codec.decode(signedBlock.encodedBlock, Type.Block);
        const carries = block.messageBlocks.some(
            (mb) => hash(Codec.encode(mb, Type.MessageBlock)) === inboundHash
        );
        if (carries) {
            return {
                signedBlock,
                author: bundle!.author as Address,
                hash: bundle!.hash
            };
        }
    }
    throw new Error("no honest block carried the pruned inbound block");
}
