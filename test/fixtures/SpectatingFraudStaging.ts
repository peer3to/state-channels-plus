// @spec-test-coverage-ignore: real double-sign input shared by strategy cases
import { Status } from "@/types";
import { FraudProofType, toSolidityFraudProofType } from "@/types/sol-enums";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";
import type {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

export async function assertSpectatingFraud(
    status: "observer" | "pending" | "participant",
    replay: boolean
) {
    const h = TestSession.getHarness();
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin();
    const victim = status === "participant" ? h.getPeer(0) : prepared.joiner;
    if (status === "pending") {
        await victim.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        expect(await h.control(victim).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
    }
    const forkId = h.activeForkId!;
    const stored = await h
        .control(victim)
        .query.getLatestBlockBundle(forkId)
        .request();
    expect(stored, "synced peer retains its latest proved block").to.not.equal(
        null
    );
    const signed = Codec.decode(
        stored!.encodedSignedBlock,
        Type.SignedBlock
    ) as SignedBlockStruct;
    const block = Codec.decode(signed.encodedBlock, Type.Block) as BlockStruct;
    const author = h.peers.find((peer) => peer.address === stored!.author)!;
    const encoded = await factory.buildAndEncodeBlock(author.signer, {
        header: {
            channelId: h.channelId,
            forkId,
            transactionCnt: stored!.height,
            participant: author.address
        },
        previousBlockHash: block.previousBlockHash
    });
    const result = await h
        .control(victim)
        .validation.runBlockValidation(encoded, {
            strategy: replay ? "spectating" : "active"
        })
        .request();
    expect(result.resultName).to.equal("DISPUTE");
    expect(result.firedHooks).to.include("doubleSignDetected");
    if (status === "observer") {
        expect(result.disputedForkIds).to.deep.equal([]);
        expect(result.fraudProofType).to.equal(null);
        expect(await h.control(victim).query.getStatus().request()).to.equal(
            Status.OPENED
        );
    } else {
        expect(result.disputedForkIds).to.deep.equal([forkId]);
        expect(result.fraudProofType).to.equal(
            String(toSolidityFraudProofType(FraudProofType.BlockDoubleSign))
        );
        expect(await h.control(victim).query.getStatus().request()).to.equal(
            status === "pending"
                ? Status.PENDING_PARTICIPANT
                : Status.PARTICIPATING
        );
    }
}
