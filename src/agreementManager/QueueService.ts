import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { BlockConfirmation } from "./types";
import { BytesLike } from "ethers";
import { Block } from "@/Block";

type forkId = BytesLike;
type Height = number;
type Adr = string;

export type Queue<T> = Map<forkId, Map<Height, Map<Adr, T>>>;

function insertNestedMapWithOverwrite<T>(
    forkMap: Queue<T>,
    forkId: forkId,
    height: Height,
    address: Adr,
    element: T
) {
    if (!forkMap.has(forkId)) {
        forkMap.set(forkId, new Map());
    }
    const heightMap = forkMap.get(forkId)!;
    if (!heightMap.has(height)) {
        heightMap.set(height, new Map());
    }
    const addressMap = heightMap.get(height)!;

    addressMap.set(address, element);
}

export default class QueueService {
    private blockQ: Queue<SignedBlockStruct> = new Map();
    private confQ: Queue<BlockConfirmation> = new Map();

    /*────────── Block queue ─────────*/

    queueBlock(sb: SignedBlockStruct): void {
        const block = Block.decode(sb.encodedBlock);
        const { forkId, height } = block.coordinates;
        const participant = block.author;
        insertNestedMapWithOverwrite(
            this.blockQ,
            forkId,
            height,
            participant,
            sb
        );
    }

    tryDequeueBlocks(forkId: forkId, height: Height): SignedBlockStruct[] {
        const heightMap = this.blockQ.get(forkId);
        if (!heightMap) return [];

        const txMap = heightMap.get(height);
        if (!txMap) return [];

        const signedBlocks = Array.from(txMap.values());
        heightMap.delete(height);

        return signedBlocks;
    }

    /*──────── Confirmation queue ────────*/

    queueConfirmation(blockConfirmation: BlockConfirmation): void {
        const block = Block.decode(
            blockConfirmation.originalSignedBlock.encodedBlock
        );
        const { forkId, height } = block.coordinates;
        const confirmationSigner = block.getSignerAddress(
            blockConfirmation.confirmationSignature
        );
        insertNestedMapWithOverwrite(
            this.confQ,
            forkId,
            height,
            confirmationSigner,
            blockConfirmation
        );
    }

    tryDequeueConfirmations(
        forkId: forkId,
        height: Height
    ): BlockConfirmation[] {
        const heightMap = this.confQ.get(forkId);
        if (!heightMap) return [];

        const txMap = heightMap.get(height);
        if (!txMap) return [];

        const blockConfirmations = Array.from(txMap.values());
        heightMap.delete(height);

        return blockConfirmations;
    }

    isBlockQueued(block: Block): boolean {
        const { forkId, height } = block.coordinates;
        const participant = block.author;

        const stored = this.blockQ.get(forkId)?.get(height)?.get(participant);
        return stored ? stored.encodedBlock === block.encode() : false;
    }
}
