import FrontierAccountProofVerifier from "./FrontierAccountProofVerifier";
import {
    accountCodeKey,
    contractStorageKey,
    systemAccountKey
} from "./frontierStateKeys";
import FrontierStorageProofVerifier from "./FrontierStorageProofVerifier";
import SubstrateHeader from "./SubstrateHeader";
import type { SubstrateHeaderJson } from "../../lightClientWire";
import AProvenStateReader, {
    type AccountStateRead,
    type NodeRequest,
    type ProvenAccountState,
    type ProvenBlock
} from "../AProvenStateReader";
import StorageProofError from "../StorageProofError";

function isHexString(value: unknown): value is string {
    return typeof value === "string" && /^0x[0-9a-f]*$/i.test(value);
}

function isHeader(answer: unknown): answer is SubstrateHeaderJson {
    const header = answer as Partial<SubstrateHeaderJson> | null;
    return (
        typeof header === "object" &&
        header !== null &&
        isHexString(header.parentHash) &&
        isHexString(header.number) &&
        isHexString(header.stateRoot) &&
        isHexString(header.extrinsicsRoot) &&
        Array.isArray(header.digest?.logs) &&
        header.digest.logs.every(isHexString)
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
        return reads.map(({ address, slots, account, code }) => ({
            address,
            storage:
                slots.length > 0
                    ? this.storageVerifier.provenStorage(
                          block.stateRoot,
                          address,
                          slots,
                          proofNodes
                      )
                    : [],
            ...(account && {
                account: this.accountVerifier.provenAccount(
                    block.stateRoot,
                    address,
                    proofNodes
                )
            }),
            ...(code && {
                code: this.accountVerifier.provenCode(
                    block.stateRoot,
                    address,
                    proofNodes
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
        if (!Array.isArray(proofNodes) || !proofNodes.every(isHexString))
            throw new StorageProofError("The node answered no read proof");
        return proofNodes;
    }
}
