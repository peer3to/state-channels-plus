import { Signer, ethers } from "ethers";
import {
    BlockStruct,
    SignedBlockStruct,
    BlockConfirmationStruct
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

import { union, isSubset } from "@/utils";

export type BlockCoordinates = {
    forkId: ForkId;
    height: BlockHeight;
};

export default class Block {
    private _onChainTimestamp?: Timestamp;
    private readonly block: BlockStruct;
    private _originalSignature: Signature;
    private _confirmationSignatures: Set<Signature>;
    private constructor(
        block: BlockStruct,
        originalSignature: Signature,
        confirmationSignatures: Set<Signature>,
        onChainTimestamp?: Timestamp
    ) {
        this.block = block;
        this._onChainTimestamp = onChainTimestamp;
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
            onChainTimestamp
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
            onChainTimestamp
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

    get originalSignature(): Signature {
        return this._originalSignature;
    }

    get confirmationSignatures(): Set<Signature> {
        return this._confirmationSignatures;
    }

    get allSignatures(): Set<Signature> {
        return union(
            this.confirmationSignatures,
            new Set([this._originalSignature])
        );
    }

    get signerAddress(): Address {
        return this.signatureToAddress(this._originalSignature);
    }
    get confirmationSignerAddresses(): Set<Address> {
        const addresses = new Set<Address>();
        for (const sig of this.confirmationSignatures) {
            addresses.add(this.signatureToAddress(sig));
        }
        return addresses;
    }

    get allSignerAddresses(): Set<Address> {
        return union(
            this.confirmationSignerAddresses,
            new Set([this.signerAddress])
        );
    }

    async signAsAuthor(signer: Signer): Promise<Block> {
        const signature = await this.sign(signer);
        this._originalSignature = signature;
        return this;
    }
    expandSignatures(newSignatures: Signature[] | Set<Signature>): Block {
        const unionSet = union(
            this._confirmationSignatures,
            new Set(newSignatures)
        );
        this._confirmationSignatures = unionSet;
        return this;
    }

    getRelevantTimestamp(nextBlockAuthor: Address): Timestamp {
        const { didSign } = this.findSignature(nextBlockAuthor);

        if (didSign) {
            // If nextBlockAuthor has signed, return block timestamp
            return this.timestamp;
        }
        // If nextBlockAuthor has NOT signed, return onChainTimestamp (or fallback)
        return this._onChainTimestamp
            ? Math.max(this._onChainTimestamp, this.timestamp)
            : this.timestamp;
    }

    equals(other: Block): boolean {
        return this.encode() === other.encode();
    }

    signatureToAddress(signature: Signature): Address {
        return ethers.verifyMessage(ethers.getBytes(this.hash), signature);
    }

    findSignature(participant: Address): {
        didSign: boolean;
        signature: Signature | undefined;
    } {
        for (const sig of this.allSignatures) {
            if (this.signatureToAddress(sig) === participant) {
                return { didSign: true, signature: sig };
            }
        }
        return { didSign: false, signature: undefined };
    }

    didEveryoneSign(participants: Address[] | Set<Address>): boolean {
        const participantsSet =
            participants instanceof Set ? participants : new Set(participants);
        if (participantsSet.size === 0) return false;
        return isSubset(participantsSet, this.allSignerAddresses);
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
}
