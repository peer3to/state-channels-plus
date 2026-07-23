import {
    AccessList,
    BlockTag,
    BlobLike,
    Provider,
    Signature,
    TransactionRequest,
    TransactionResponse,
    TransactionResponseParams,
    accessListify,
    assert,
    getBigInt,
    getNumber,
    hexlify,
    isBytesLike,
    resolveAddress,
    toQuantity
} from "ethers";

interface SerializedBlob {
    data: string;
    proof: string;
    commitment: string;
}

export interface SerializedTransactionRequest {
    type?: number;
    to?: string;
    from?: string;
    nonce?: number;
    gasLimit?: string;
    gasPrice?: string;
    maxPriorityFeePerGas?: string;
    maxFeePerGas?: string;
    maxFeePerBlobGas?: string;
    data?: string;
    value?: string;
    chainId?: string;
    accessList?: AccessList;
    blockTag?: BlockTag;
    enableCcipRead?: boolean;
    blobVersionedHashes?: string[];
    blobs?: Array<string | SerializedBlob>;
}

export interface SerializedTransactionResponse {
    blockNumber: number | null;
    blockHash: string | null;
    hash: string;
    index: number;
    type: number;
    to: string | null;
    from: string;
    nonce: number;
    gasLimit: string;
    gasPrice: string;
    maxPriorityFeePerGas: string | null;
    maxFeePerGas: string | null;
    maxFeePerBlobGas: string | null;
    data: string;
    value: string;
    chainId: string;
    serializedSignature: string;
    accessList: AccessList | null;
    blobVersionedHashes: string[] | null;
}

const BIGINT_FIELDS = [
    "gasLimit",
    "gasPrice",
    "maxPriorityFeePerGas",
    "maxFeePerGas",
    "maxFeePerBlobGas",
    "value",
    "chainId"
] as const;

function serializeBlob(blob: BlobLike): string | SerializedBlob {
    if (isBytesLike(blob)) return hexlify(blob);
    return {
        data: hexlify(blob.data),
        proof: hexlify(blob.proof),
        commitment: hexlify(blob.commitment)
    };
}

export async function serializeTransactionRequest(
    tx: TransactionRequest,
    provider: Provider | null
): Promise<SerializedTransactionRequest> {
    assert(
        tx.customData == null,
        "custom transaction data cannot cross the runtime port",
        "UNSUPPORTED_OPERATION",
        { operation: "serializeTransactionRequest" }
    );
    assert(
        tx.kzg == null,
        "KZG functions cannot cross the runtime port",
        "UNSUPPORTED_OPERATION",
        { operation: "serializeTransactionRequest" }
    );

    const serialized: SerializedTransactionRequest = {};
    if (tx.type != null) serialized.type = getNumber(tx.type, "tx.type");
    if (tx.to != null) serialized.to = await resolveAddress(tx.to, provider);
    if (tx.from != null) {
        serialized.from = await resolveAddress(tx.from, provider);
    }
    if (tx.nonce != null) serialized.nonce = getNumber(tx.nonce, "tx.nonce");
    if (tx.data != null) serialized.data = hexlify(tx.data);
    for (const field of BIGINT_FIELDS) {
        const value = tx[field];
        if (value != null) serialized[field] = toQuantity(value);
    }
    if (tx.accessList != null) {
        serialized.accessList = accessListify(tx.accessList);
    }
    if (tx.blockTag != null) serialized.blockTag = tx.blockTag;
    if (tx.enableCcipRead != null) {
        serialized.enableCcipRead = tx.enableCcipRead;
    }
    if (tx.blobVersionedHashes != null) {
        serialized.blobVersionedHashes = tx.blobVersionedHashes.map((hash) =>
            hash.toLowerCase()
        );
    }
    if (tx.blobs != null) serialized.blobs = tx.blobs.map(serializeBlob);
    return serialized;
}

export function deserializeTransactionRequest(
    serialized: SerializedTransactionRequest
): TransactionRequest {
    const tx: TransactionRequest = {};
    if (serialized.type != null) tx.type = serialized.type;
    if (serialized.to != null) tx.to = serialized.to;
    if (serialized.from != null) tx.from = serialized.from;
    if (serialized.nonce != null) tx.nonce = serialized.nonce;
    if (serialized.data != null) tx.data = serialized.data;
    for (const field of BIGINT_FIELDS) {
        const value = serialized[field];
        if (value != null) tx[field] = getBigInt(value, `tx.${field}`);
    }
    if (serialized.accessList != null) tx.accessList = serialized.accessList;
    if (serialized.blockTag != null) tx.blockTag = serialized.blockTag;
    if (serialized.enableCcipRead != null) {
        tx.enableCcipRead = serialized.enableCcipRead;
    }
    if (serialized.blobVersionedHashes != null) {
        tx.blobVersionedHashes = serialized.blobVersionedHashes.slice();
    }
    if (serialized.blobs != null) tx.blobs = serialized.blobs.slice();
    return tx;
}

export function serializeTransactionResponse(
    tx: TransactionResponse
): SerializedTransactionResponse {
    return {
        blockNumber: tx.blockNumber,
        blockHash: tx.blockHash,
        hash: tx.hash,
        index: tx.index,
        type: tx.type,
        to: tx.to,
        from: tx.from,
        nonce: tx.nonce,
        gasLimit: toQuantity(tx.gasLimit),
        gasPrice: toQuantity(tx.gasPrice ?? tx.maxFeePerGas ?? 0n),
        maxPriorityFeePerGas:
            tx.maxPriorityFeePerGas == null
                ? null
                : toQuantity(tx.maxPriorityFeePerGas),
        maxFeePerGas:
            tx.maxFeePerGas == null ? null : toQuantity(tx.maxFeePerGas),
        maxFeePerBlobGas:
            tx.maxFeePerBlobGas == null
                ? null
                : toQuantity(tx.maxFeePerBlobGas),
        data: tx.data,
        value: toQuantity(tx.value),
        chainId: toQuantity(tx.chainId),
        serializedSignature: tx.signature.serialized,
        accessList: tx.accessList,
        blobVersionedHashes: tx.blobVersionedHashes
    };
}

export function deserializeTransactionResponse(
    serialized: SerializedTransactionResponse,
    provider: Provider
): TransactionResponse {
    const params: TransactionResponseParams = {
        blockNumber: serialized.blockNumber,
        blockHash: serialized.blockHash,
        hash: serialized.hash,
        index: serialized.index,
        type: serialized.type,
        to: serialized.to,
        from: serialized.from,
        nonce: serialized.nonce,
        gasLimit: getBigInt(serialized.gasLimit),
        gasPrice: getBigInt(serialized.gasPrice),
        maxPriorityFeePerGas:
            serialized.maxPriorityFeePerGas == null
                ? null
                : getBigInt(serialized.maxPriorityFeePerGas),
        maxFeePerGas:
            serialized.maxFeePerGas == null
                ? null
                : getBigInt(serialized.maxFeePerGas),
        maxFeePerBlobGas:
            serialized.maxFeePerBlobGas == null
                ? null
                : getBigInt(serialized.maxFeePerBlobGas),
        data: serialized.data,
        value: getBigInt(serialized.value),
        chainId: getBigInt(serialized.chainId),
        signature: Signature.from(serialized.serializedSignature),
        accessList: serialized.accessList,
        blobVersionedHashes: serialized.blobVersionedHashes
    };
    return new TransactionResponse(params, provider);
}
