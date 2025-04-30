import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import { BlockConfirmation } from "./types";
import { BlockUtils, EvmUtils } from "@/utils";

type ForkCnt = number;
type Height = number;
type Adr = string;

export type Queue<T> = Map<ForkCnt, Map<Height, Map<Adr, T>>>;

function insertNestedMapWithOverwrite<T>(
    forkMap: Queue<T>,
    forkCnt: ForkCnt,
    height: Height,
    address: Adr,
    element: T
) {
    if (!forkMap.has(forkCnt)) {
        forkMap.set(forkCnt, new Map());
    }
    const heightMap = forkMap.get(forkCnt)!;
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
        const block = EvmUtils.decodeBlock(sb.encodedBlock);
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        const participant = BlockUtils.getBlockAuthor(block);
        insertNestedMapWithOverwrite(
            this.blockQ,
            forkCnt,
            height,
            participant,
            sb
        );
    }

    tryDequeueBlocks(forkCnt: ForkCnt, height: Height): SignedBlockStruct[] {
        const heightMap = this.blockQ.get(forkCnt);
        if (!heightMap) return [];

        const txMap = heightMap.get(height);
        if (!txMap) return [];

        const signedBlocks = Array.from(txMap.values());
        heightMap.delete(height);

        return signedBlocks;
    }

    /*──────── Confirmation queue ────────*/

    queueConfirmation(blockConfirmation: BlockConfirmation): void {
        const block = EvmUtils.decodeBlock(
            blockConfirmation.originalSignedBlock.encodedBlock
        );
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        const confirmationSigner = EvmUtils.retrieveSignerAddressBlock(
            block,
            blockConfirmation.confirmationSignature
        );
        insertNestedMapWithOverwrite(
            this.confQ,
            forkCnt,
            height,
            confirmationSigner,
            blockConfirmation
        );
    }

    tryDequeueConfirmations(
        forkCnt: ForkCnt,
        height: Height
    ): BlockConfirmation[] {
        const heightMap = this.confQ.get(forkCnt);
        if (!heightMap) return [];

        const txMap = heightMap.get(height);
        if (!txMap) return [];

        const blockConfirmations = Array.from(txMap.values());
        heightMap.delete(height);

        return blockConfirmations;
    }

    isBlockQueued(block: BlockStruct): boolean {
        const { forkCnt, height } = BlockUtils.getCoordinates(block);
        const participant = BlockUtils.getBlockAuthor(block);

        const stored = this.blockQ.get(forkCnt)?.get(height)?.get(participant);
        return stored
            ? stored.encodedBlock === EvmUtils.encodeBlock(block)
            : false;
    }
}
