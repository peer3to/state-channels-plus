import FrontierAccountProofVerifier from "./FrontierAccountProofVerifier";
import {
    accountCodeKey,
    contractStorageKey,
    systemAccountKey
} from "./frontierStateKeys";
import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import SubstrateTrieProof from "./SubstrateTrieProof";
import type { SubstrateHeaderJson } from "../../lightClientWire";
import AProvenStateReader, {
    type AccountStateRead,
    type NodeRequest,
    type ProvenAccountState,
    type ProvenBlock
} from "../AProvenStateReader";
import StorageProofError from "../StorageProofError";
import { isHexString } from "ethers";

/** Whether `value` is hex of whole bytes, as every hash, log and proof node is. */
function isBytes(value: unknown): value is string {
    return isHexString(value, true);
}

function isHeader(answer: unknown): answer is SubstrateHeaderJson {
    const header = answer as Partial<SubstrateHeaderJson> | null;
    return (
        typeof header === "object" &&
        header !== null &&
        isBytes(header.parentHash) &&
        isHexString(header.number) &&
        isBytes(header.stateRoot) &&
        isBytes(header.extrinsicsRoot) &&
        Array.isArray(header.digest?.logs) &&
        header.digest.logs.every(isBytes)
    );
}

/**
 * Proven state of a Frontier chain, read through the node's Substrate RPC:
 * `chain_getHeader` for the best block and one `state_getReadProof` for
 * everything a read asks.
 */
export default class FrontierProvenStateReader extends AProvenStateReader {
    private readonly requestNode: NodeRequest;
    private readonly storageVerifier = new FrontierStorageProofVerifier();
    private readonly accountVerifier: FrontierAccountProofVerifier;

    /** `existentialDeposit` is the chain's, a runtime constant. */
    constructor(requestNode: NodeRequest, existentialDeposit: bigint) {
        super();
        this.requestNode = requestNode;
        this.accountVerifier = new FrontierAccountProofVerifier(
            existentialDeposit
        );
    }

    async head(): Promise<ProvenBlock> {
        const answer = await this.requestNode("chain_getHeader", []);
        if (!isHeader(answer))
            throw new StorageProofError("The node answered no block header");
        const header = new SubstrateHeader(answer);
        return {
            number: header.number,
            hash: header.hash,
            ethereumBlockHash: header.ethereumBlockHash(),
            stateRoot: header.stateRoot
        };
    }

    async read(
        block: ProvenBlock,
        reads: AccountStateRead[]
    ): Promise<ProvenAccountState[]> {
        const keys = reads.flatMap(({ address, slots, account, code }) => [
            ...slots.map((slot) => contractStorageKey(address, slot)),
            ...(account ? [systemAccountKey(address)] : []),
            ...(code ? [accountCodeKey(address)] : [])
        ]);
        // a read that asks nothing needs no proof
        const proofNodes =
            keys.length > 0 ? await this.readProof(block, keys) : [];
        // one proof for the whole read, so each of its nodes is hashed once
        const proof = new SubstrateTrieProof(proofNodes);
        return reads.map(({ address, slots, account, code }) => ({
            address,
            storage:
                slots.length > 0
                    ? this.storageVerifier.storageIn(
                          proof,
                          block.stateRoot,
                          address,
                          slots
                      )
                    : [],
            ...(account && {
                account: this.accountVerifier.accountIn(
                    proof,
                    block.stateRoot,
                    address
                )
            }),
            ...(code && {
                code: this.accountVerifier.codeIn(
                    proof,
                    block.stateRoot,
                    address
                )
            })
        }));
    }

    /** One proof of all of `keys` at `block`, as the node gave it. */
    private async readProof(
        block: ProvenBlock,
        keys: string[]
    ): Promise<string[]> {
        const answer = (await this.requestNode("state_getReadProof", [
            keys,
            block.hash
        ])) as { proof?: unknown } | null;
        const proofNodes = answer?.proof;
        if (!Array.isArray(proofNodes) || !proofNodes.every(isBytes))
            throw new StorageProofError("The node answered no read proof");
        return proofNodes;
    }
}
