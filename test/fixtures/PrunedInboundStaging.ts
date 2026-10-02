// @spec-test-coverage-ignore: genuine inbound consumed and pruned by a same-fork snapshot, shared by the unit and E2E declarations
import type { ForkId } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import * as factory from "@test/factory";
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
export async function findCarrier(forkId: ForkId, inboundHash: string) {
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
                author: bundle!.author,
                hash: bundle!.hash
            };
        }
    }
    throw new Error("no honest block carried the pruned inbound block");
}

/** the next writer authors a block carrying a fabricated inbound block one above the pruned head; another peer ingests it and stores the forged-inbound proof */
export async function storeForgedInboundProofAboveHead(
    prunedInbound: MessageBlockStruct
) {
    const h = TestSession.getHarness();
    const forkId = h.activeForkId!;
    const writer = await h.query.getNextPeerToWrite();
    const observer = h.peers.find((peer) => peer.index !== writer.index)!;
    const latest = await h
        .control(observer)
        .query.getLatestBlockBundle(forkId)
        .request();
    const height = await h
        .control(observer)
        .query.getNextBlockHeight(forkId)
        .request();
    const timestamp = latest!.timestamp + 1;
    const call = await h
        .getPeer(writer.index)
        .p2pInstance.p2pContractInstance.add.populateTransaction(1);
    const fabricated = factory.messageBlock({
        previousBlockHash: hash(Codec.encode(prunedInbound, Type.MessageBlock)),
        blockHeight: BigInt(prunedInbound.blockHeight) + 1n,
        timestamp: BigInt(timestamp)
    });
    const encoded = await factory.buildAndEncodeBlock(
        h.getPeer(writer.index).signer,
        {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: height,
                timestamp
            },
            transaction: factory.transaction({
                body: { encodedData: call.data, data: call.data }
            }),
            previousBlockHash: latest!.hash,
            messageBlocks: [fabricated]
        }
    );
    const probe = await h
        .control(observer)
        .validation.runBlockIngest(encoded)
        .request();
    expect(probe.firedHooks).to.include("forgedInboundMessageBlockDetected");
    return { author: writer.address, observer };
}
