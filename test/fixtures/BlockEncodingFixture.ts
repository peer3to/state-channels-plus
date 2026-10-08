// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import * as factory from "../factory";
import type { Address, Bytes, ForkId } from "@/types/types";
import type { MessageBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { ethers } from "ethers";

/** A block author's signature over exactly these block bytes. */
export function signEncodedBlock(
    wallet: ethers.BaseWallet,
    encodedBlock: Bytes
): string {
    return wallet.signMessageSync(
        ethers.getBytes(ethers.keccak256(encodedBlock))
    );
}

/**
 * A genuinely authored, linked next block - only its stateSnapshotHash (the
 * factory's random default) is wrong, so it dies at the state-transition
 * gate. The transaction is the writer's `add(1)`, or `transactionData` when
 * given.
 */
export async function encodeLinkedNextBlock(
    h: MathPeerTestHarness,
    writerIndex: number,
    observerIndex: number,
    forkId: ForkId,
    messageBlocks?: MessageBlockStruct[],
    transactionData?: string
) {
    const writer = h.getPeer(writerIndex);
    const observer = h.getPeer(observerIndex);
    const bundle = await h
        .control(observer)
        .query.getLatestBlockBundle(forkId)
        .request();
    const height = await h
        .control(observer)
        .query.getNextBlockHeight(forkId)
        .request();
    const data =
        transactionData ??
        (
            await writer.p2pInstance.p2pContractInstance.add.populateTransaction(
                1
            )
        ).data;

    return factory.buildAndEncodeBlock(writer.signer, {
        header: {
            channelId: h.channelId,
            forkId,
            transactionCnt: height,
            participant: writer.address as Address,
            // inside the previous block's p2pTime window regardless of how
            // long the test staging took
            timestamp: bundle!.timestamp + 1
        },
        transaction: factory.transaction({
            body: {
                encodedData: data,
                data
            }
        }),
        previousBlockHash: bundle!.hash,
        ...(messageBlocks ? { messageBlocks } : {})
    });
}
