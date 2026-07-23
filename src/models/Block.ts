import { Signer, ethers } from "ethers";
import {
    BlockStruct,
    SignedBlockStruct,
    BlockConfirmationStruct,
    MessageBlockStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
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

import { getChecksumAddress } from "@/utils/address";
import { SignatureUtils } from "@/utils/SignatureUtils";
import { isSubset, union } from "@/utils/set";
import { recoverSigner } from "@/cache";

export type BlockCoordinates = {
    forkId: ForkId;
    height: BlockHeight;
};

export default class Block {
    private _onChainTimestamp?: Timestamp;
    private readonly block: BlockStruct;
    private _encodedBlock?: Bytes;
    private _blockHash?: Hash;
    private _blockHashBytes?: Uint8Array;
    private _originalSignature: Signature;
    private _confirmationSignatures: Set<Signature>;
    private constructor(
        block: BlockStruct,
        originalSignature: Signature,
        confirmationSignatures: Set<Signature>,
        onChainTimestamp?: Timestamp,
        encodedBlock?: Bytes
    ) {
        this.block = block;
        this._onChainTimestamp = onChainTimestamp;
        this._encodedBlock = encodedBlock;
        this._originalSignature = originalSignature;
        this._confirmationSignatures = confirmationSignatures;
    }

    static fromBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        onChainTimestamp?: Timestamp
    ): Block {
        const block = Codec.decode(
            blockConfirmation.signedBlock.encodedBlock,
            Type.Block
        );
        return new Block(
            block,
            blockConfirmation.signedBlock.signature as Signature,
            new Set(blockConfirmation.signatures as Signature[]),
            onChainTimestamp,
            blockConfirmation.signedBlock.encodedBlock as Bytes
        );
    }
    static fromSignedBlock(
        signedBlock: SignedBlockStruct,
        onChainTimestamp?: Timestamp
    ): Block {
        return new Block(
            Codec.decode(signedBlock.encodedBlock, Type.Block),
            signedBlock.signature as Signature,
            new Set(),
            onChainTimestamp,
            signedBlock.encodedBlock as Bytes
        );
    }

    static tryFromBlockConfirmation(
        blockConfirmation: BlockConfirmationStruct,
        onChainTimestamp?: Timestamp
    ): Block | null {
        try {
            return Block.fromBlockConfirmation(
                blockConfirmation,
                onChainTimestamp
            );
        } catch {
            return null;
        }
    }

    static tryFromSignedBlock(
        signedBlock: SignedBlockStruct,
        onChainTimestamp?: Timestamp
    ): Block | null {
        try {
            return Block.fromSignedBlock(signedBlock, onChainTimestamp);
        } catch {
            return null;
        }
    }

    static async fromBlockStruct(
        blockStruct: BlockStruct,
        signer: Signer,
        onChainTimestamp?: Timestamp
    ): Promise<Block> {
        const encodedBlock = Codec.encode(blockStruct, Type.Block);
        const signature = await SignatureUtils.signMsg(encodedBlock, signer);

        return new Block(
            blockStruct,
            signature as Signature,
            new Set(),
            onChainTimestamp,
            encodedBlock
        );
    }

    get blockStruct(): BlockStruct {
        return this.block;
    }
    get signedBlock(): SignedBlockStruct {
        return {
            encodedBlock: this.encode(),
            signature: this._originalSignature as Bytes
        };
    }

    get blockConfirmationStruct(): BlockConfirmationStruct {
        return {
            signedBlock: this.signedBlock,
            signatures: Array.from(this.confirmationSignatures) as Bytes[]
        };
    }

    encode(): Bytes {
        this._encodedBlock ??= Codec.encode(this.block, Type.Block);
        return this._encodedBlock;
    }

    get coordinates(): { forkId: ForkId; height: BlockHeight } {
        return {
            forkId: this.block.transaction.header.forkId as ForkId,
            height: Number(this.block.transaction.header.transactionCnt)
        };
    }

    get hash(): Hash {
        this._blockHash ??= ethers.keccak256(this.encode()) as Hash;
        return this._blockHash;
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
    get currentTimestamp(): Timestamp {
        return this._onChainTimestamp ?? this.timestamp;
    }

    set onChainTimestamp(onChainTimestamp: Timestamp | undefined) {
        this._onChainTimestamp = onChainTimestamp;
    }
    get author() {
        return getChecksumAddress(
            this.block.transaction.header.participant
        ) as Address;
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

    get tx() {
        return this.block.transaction;
    }

    get messageBlocks(): MessageBlockStruct[] {
        return this.block.messageBlocks;
    }

    get originalSignature(): Signature {
        return this._originalSignature;
    }

    get confirmationSignatures(): Set<Signature> {
        return this._confirmationSignatures;
    }

    get allSignatures(): Set<Signature> {
        return union(
            this._confirmationSignatures,
            new Set([this._originalSignature])
        );
    }

    get signerAddress(): Address {
        return this.signatureToAddress(this._originalSignature);
    }
    get confirmationSignerAddresses(): Set<Address> {
        const addresses = new Set<Address>();
        for (const sig of this._confirmationSignatures) {
            addresses.add(this.signatureToAddress(sig));
        }
        return addresses;
    }

    get allSignerAddresses(): Set<Address> {
        return this.deriveAllSignerAddresses();
    }

    async signAsAuthor(signer: Signer): Promise<Block> {
        this._originalSignature = await this.sign(signer);
        return this;
    }
    expandSignatures(newSignatures: Signature[] | Set<Signature>): Block {
        for (const signature of newSignatures) {
            this._confirmationSignatures.add(signature);
        }
        return this;
    }

    /** Drop confirmation signatures (the author's original signature is kept). */
    removeConfirmationSignatures(signatures: Set<Signature>): Block {
        for (const signature of signatures) {
            this._confirmationSignatures.delete(signature);
        }
        return this;
    }

    getRelevantTimestamp(nextBlockAuthor: Address): Timestamp {
        const signature = this.findSignature(nextBlockAuthor);

        if (signature) {
            // If nextBlockAuthor has signed, return block timestamp
            return this.timestamp;
        }
        // If nextBlockAuthor has NOT signed, return onChainTimestamp (or fallback)
        return this._onChainTimestamp
            ? Math.max(Number(this._onChainTimestamp), Number(this.timestamp))
            : Number(this.timestamp);
    }

    equals(other: Block): boolean {
        return this.encode() === other.encode();
    }

    signatureToAddress(signature: Signature): Address {
        // Recovery is memoized per-thread by (blockHash, signature) in the
        // global cache, so no per-instance cache is needed.
        return recoverSigner(this.getHashBytes(), signature);
    }

    findSignature(participant: Address): Signature | undefined {
        const expected = getChecksumAddress(participant) as Address;
        if (this.signatureToAddress(this._originalSignature) === expected) {
            return this._originalSignature;
        }
        for (const sig of this._confirmationSignatures) {
            if (this.signatureToAddress(sig) === expected) return sig;
        }
        return undefined;
    }

    didEveryoneSign(participants: Address[] | Set<Address>): boolean {
        const rawSet =
            participants instanceof Set ? participants : new Set(participants);
        const participantsSet = new Set<Address>();
        for (const participant of rawSet) {
            participantsSet.add(getChecksumAddress(participant) as Address);
        }
        if (participantsSet.size === 0) return false;
        return isSubset(participantsSet, this.deriveAllSignerAddresses());
    }

    didSign(participant: Address): boolean {
        return this.deriveAllSignerAddresses().has(
            getChecksumAddress(participant) as Address
        );
    }

    sign(signer: Signer): Promise<Signature> {
        return signer.signMessage(ethers.getBytes(this.hash));
    }

    async signBlock(signer: Signer): Promise<SignedBlockStruct> {
        return {
            encodedBlock: this.encode(),
            signature: (await this.sign(signer)) as Bytes
        };
    }

    private getHashBytes(): Uint8Array {
        this._blockHashBytes ??= ethers.getBytes(this.hash);
        return this._blockHashBytes;
    }

    // Derived on demand — each signatureToAddress hits the global recovery cache.
    private deriveAllSignerAddresses(): Set<Address> {
        const addresses = new Set<Address>([this.signerAddress]);
        for (const sig of this._confirmationSignatures) {
            addresses.add(this.signatureToAddress(sig));
        }
        return addresses;
    }
}
