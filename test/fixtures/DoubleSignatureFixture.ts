// @spec-test-coverage-ignore: shared fixture builds real signatures and block copies; executable evidence belongs to its calling test declarations
import StateSnapshot from "@/models/StateSnapshot";
import { Codec, Type } from "@/utils";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { MathTestSession } from "@test/harness";
import type { TestPeer } from "@test/harness/core/types";
import type { MathStateMachine } from "@typechain-types";
import type { JoinChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

/**
 * The peer's latest stored block, and a copy of its confirmation that carries
 * `signatures` instead of the stored ones, ready for the wire.
 */
export async function latestBlockCopy(
    peer: TestPeer,
    signaturesFor: (blockHash: string) => string[]
) {
    const h = MathTestSession.getHarness();
    const block = await h
        .control(peer)
        .query.getLatestBlockBundle(h.activeForkId!)
        .request();
    expect(block, `peer ${peer.index} stored no block`).to.not.equal(null);
    const { signedBlock } = Codec.decode(
        block!.encodedBlockConfirmation,
        Type.BlockConfirmation
    );
    const signatures = signaturesFor(block!.hash);
    return {
        hash: block!.hash,
        signedBlock,
        signatures,
        encodedBlockConfirmation: String(
            Codec.encode({ signedBlock, signatures }, Type.BlockConfirmation)
        )
    };
}

/**
 * A join request for `participant` signed by `signature`, encoded for the wire,
 * together with the channel's real pinned snapshot hash and fork.
 */
export type JoinRequest = {
    encodedSignedJoinChannel: string;
    expectedSnapshotHash: string;
    expectedForkId: string;
};

export async function encodeJoinRequest(
    joinChannel: JoinChannelStruct,
    signature: string
): Promise<JoinRequest> {
    const h = MathTestSession.getHarness();
    const snapshot = StateSnapshot.from(
        await h.channelManager.getStateSnapshot(h.channelId)
    );
    return {
        encodedSignedJoinChannel: String(
            Codec.encode(
                {
                    encodedJoinChannel: Codec.encode(
                        joinChannel,
                        Type.JoinChannel
                    ),
                    signature
                },
                Type.SignedJoinChannel
            )
        ),
        expectedSnapshotHash: String(snapshot.hash),
        expectedForkId: String(snapshot.forkID)
    };
}

/**
 * Send a join signature request from `from` to `toAddress` over the real join
 * RPC and return the receiver's rejection message, or `undefined` if it signed.
 */
export async function sendJoinSignatureRequest(
    from: TestPeer<HarnessControlRpc, MathStateMachine>,
    toAddress: string,
    request: JoinRequest
): Promise<string | undefined> {
    const h = MathTestSession.getHarness();
    return h.execOnHost(
        from,
        async (sm, args) => {
            try {
                await sm.p2pManager.remoteRpc.joinChannelService
                    .requestJoinSignature(
                        args.encodedSignedJoinChannel,
                        args.expectedSnapshotHash,
                        args.expectedForkId
                    )
                    .request(args.toAddress);
                return undefined;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
        },
        { ...request, toAddress }
    );
}
