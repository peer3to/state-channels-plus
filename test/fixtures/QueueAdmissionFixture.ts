// @spec-test-coverage-ignore: shared fixture triggers production behavior; executable evidence belongs to its calling test declarations
import * as factory from "../factory";
import { Block } from "@/models";
import { BlockOrigin, QueueStorage } from "@/storage/QueueStorage";
import { Bytes, ForkId, Hash, Signature } from "@/types/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { ethers } from "ethers";

/** Real signed domain blocks with deterministic identities and nonce variants. */
export class QueueAdmissionFixture {
    public readonly wallets = Array.from(
        { length: 6 },
        (_, index) => new ethers.Wallet(ethers.toBeHex(index + 1, 32))
    );
    public readonly block: Block;
    public readonly queue: QueueStorage;

    constructor(maximum = 3, height = 0, forkId?: ForkId) {
        this.queue = new QueueStorage(maximum);
        const unsigned = factory.block({
            header: {
                ...(forkId === undefined ? {} : { forkId }),
                participant: this.wallets[0].address,
                transactionCnt: height
            }
        });
        this.block = Block.fromSignedBlock({
            encodedBlock: unsigned.encode(),
            signature: this.wallets[0].signMessageSync(
                ethers.getBytes(unsigned.hash)
            )
        });
    }

    signature(signer = 1, variant = 0): string {
        return signBlockVariant(this.wallets[signer], this.block.hash, variant);
    }

    copy(signatures: Signature[] = [], timestamp?: number): Block {
        return Block.fromBlockConfirmation(
            {
                signedBlock: this.block.signedBlock,
                signatures: signatures as Bytes[]
            },
            timestamp
        );
    }

    alternateEnvelope(variant: number, signatures: Signature[] = []): Block {
        return Block.fromBlockConfirmation({
            signedBlock: {
                encodedBlock: this.block.encode(),
                signature: this.signature(0, variant)
            },
            signatures: signatures as Bytes[]
        });
    }

    offer(source: number, signatures: Signature[] = [], timestamp?: number) {
        return this.queue.queueBlock(this.copy(signatures, timestamp), {
            origin: BlockOrigin.NETWORK,
            senderAddress: this.wallets[source].address
        });
    }

    take() {
        return this.queue.tryDequeueAt(this.block.forkId, this.block.height)[0];
    }

    entry() {
        return this.queue.getQueuedEntry(this.block.hash)!;
    }
}

export function signBlockVariant(
    wallet: ethers.BaseWallet,
    blockHash: Hash,
    variant: number
): string {
    const signed = secp256k1.sign(
        ethers.getBytes(ethers.hashMessage(ethers.getBytes(blockHash))),
        ethers.getBytes(wallet.privateKey),
        {
            extraEntropy: ethers.getBytes(ethers.toBeHex(variant + 1, 32))
        }
    );
    return ethers.Signature.from({
        r: ethers.toBeHex(signed.r, 32),
        s: ethers.toBeHex(signed.s, 32),
        v: 27 + signed.recovery
    }).serialized;
}
