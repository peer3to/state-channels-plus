import {
    SignedBlockStruct,
    BlockStruct
} from "@typechain-types/contracts/V1/DataTypes";
import EvmUtils from "@/utils/EvmUtils";
import { BlockConfirmation } from "./types";
import { coordinatesOf, participantOf } from "@/utils";

type ForkCnt = number;
type Height = number;
type Adr = string;

export type Queue<T> = Map<ForkCnt, Map<Height, Map<Adr, T>>>;

function ensure<K, V>(map: Map<K, V>, key: K, defaultFactory: () => V): V {
    if (!map.has(key)) {
        map.set(key, defaultFactory());
    }
    return map.get(key)!;
}

export default class QueueService {
    private blockQ: Queue<SignedBlockStruct> = new Map();
    private confQ: Queue<BlockConfirmation> = new Map();

    /*────────── Block queue ─────────*/

    queueBlock(sb: SignedBlockStruct): void {
        const block = EvmUtils.decodeBlock(sb.encodedBlock);
        const { forkCnt, height } = coordinatesOf(block);
        const participant = participantOf(block);

        const heightMap = ensure(this.blockQ, forkCnt, () => new Map());
        const txMap = ensure(heightMap, height, () => new Map());
        txMap.set(participant, sb);
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

    public queueConfirmation(blockConfirmation: BlockConfirmation) {
        const block = EvmUtils.decodeBlock(
            blockConfirmation.originalSignedBlock.encodedBlock
        );
        const { forkCnt, height } = coordinatesOf(block);

        const confirmationSigner = EvmUtils.retrieveSignerAddressBlock(
            block,
            blockConfirmation.confirmationSignature
        );
        //TODO!!! - since this is in the future, we can't know who's part of the channel - somone can bloat state, so spam has to be handeled in the p2pManager
        const heightMap = ensure(this.confQ, forkCnt, () => new Map());
        const txMap = ensure(heightMap, height, () => new Map());
        txMap.set(confirmationSigner, blockConfirmation);
    }

    public tryDequeueConfirmations(
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
        const { forkCnt, height } = coordinatesOf(block);
        const participant = participantOf(block);

        const stored = this.blockQ.get(forkCnt)?.get(height)?.get(participant);
        return stored
            ? stored.encodedBlock === EvmUtils.encodeBlock(block)
            : false;
    }
}
