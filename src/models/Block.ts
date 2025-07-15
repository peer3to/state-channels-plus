import { Signer, ethers } from "ethers";
import { BlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, Type } from "../utils/Codec";
import {
    ForkId,
    BlockHeight,
    Timestamp,
    Address,
    ChannelId,
    Hash,
    Signature,
    Bytes
} from "@/types/types";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type BlockCoordinates = {
    forkId: ForkId;
    height: BlockHeight;
};

export default class Block {
    private _onChainTimestamp?: Timestamp;

    private constructor(private readonly block: BlockStruct) {}

    static from(block: BlockStruct): Block {
        return new Block(block);
    }

    static decode(encodedBlock: Bytes): Block {
        const block = Codec.decode(encodedBlock, Type.Block);
        return new Block(block);
    }

    toStruct(): BlockStruct {
        return this.block;
    }

    encode(): Bytes {
        return Codec.encode(this.block, Type.Block);
    }

    get coordinates(): { forkId: ForkId; height: BlockHeight } {
        return {
            forkId: this.block.transaction.header.forkId as ForkId,
            height: Number(this.block.transaction.header.transactionCnt)
        };
    }

    get hash(): Hash {
        return ethers.keccak256(this.encode());
    }

    get height(): BlockHeight {
        return Number(this.block.transaction.header.transactionCnt);
    }

    get forkId(): ForkId {
        return this.block.transaction.header.forkId as ForkId;
    }

    get timestamp(): Timestamp {
        return Number(this.block.transaction.header.timestamp);
    }

    get onChainTimestamp(): Timestamp | undefined {
        return this._onChainTimestamp;
    }
    get relevantTimestamp(): Timestamp {
        return this._onChainTimestamp ?? this.timestamp;
    }

    set onChainTimestamp(onChainTimestamp: Timestamp) {
        this._onChainTimestamp = onChainTimestamp;
    }

    get author() {
        return this.block.transaction.header.participant as Address;
    }

    get channelId() {
        return this.block.transaction.header.channelId as ChannelId;
    }

    get previousBlockHash() {
        return this.block.previousBlockHash as Hash;
    }

    get stateSnapshotHash() {
        return this.block.stateSnapshotHash as Hash;
    }

    get transaction() {
        return this.block.transaction;
    }

    equals(other: Block): boolean {
        return this.encode() === other.encode();
    }

    getSignerAddress(signature: Signature | Bytes): Address {
        return ethers.verifyMessage(
            ethers.getBytes(this.hash),
            signature as Signature
        );
    }

    getSignersSet(signatures: Signature[]): Set<Address> {
        return new Set(signatures.map((sig) => this.getSignerAddress(sig)));
    }

    getParticipantSignature(
        participant: Address,
        signatures: Signature[]
    ): { didSign: boolean; signature: Signature | undefined } {
        for (const sig of signatures) {
            if (this.getSignerAddress(sig) === participant) {
                return { didSign: true, signature: sig };
            }
        }
        return { didSign: false, signature: undefined };
    }

    sign(signer: Signer): Promise<Signature> {
        return signer.signMessage(ethers.getBytes(this.hash));
    }

    async signedBlock(signer: Signer): Promise<SignedBlockStruct> {
        return {
            encodedBlock: this.encode(),
            signature: (await this.sign(signer)) as Bytes
        };
    }
}
