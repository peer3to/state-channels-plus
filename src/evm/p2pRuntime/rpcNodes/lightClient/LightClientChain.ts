import type AProvenStateReader from "./proof/AProvenStateReader";
import type { NodeRequest } from "./proof/AProvenStateReader";
import { PEER3_CHAIN_CONSTANTS } from "./proof/substrate/FrontierChainConstants";
import FrontierProvenStateReader from "./proof/substrate/FrontierProvenStateReader";

/** What the light client must know of the chain its nodes serve. */
export type LightClientChain = {
    /** The reader of the chain's proof representation, over requests to a node. */
    createReader: (requestNode: NodeRequest) => AProvenStateReader;
    /**
     * Addresses the chain answers with a precompile of its own that a local
     * EVM does not reproduce, lowercase. A call that reaches one runs on the
     * node.
     */
    chainPrecompiles: readonly string[];
};

/**
 * The peer3 chain (`zero-fee-runtime`, peer3-parachain at d845dbfb): a
 * Frontier chain whose runtime adds the XCM precompile to Ethereum's
 * precompiles 1 to 9 (`runtime/src/precompiles.rs`).
 */
export const PEER3_LIGHT_CLIENT_CHAIN: LightClientChain = {
    createReader: (requestNode) =>
        new FrontierProvenStateReader(requestNode, PEER3_CHAIN_CONSTANTS),
    chainPrecompiles: ["0x0000000000000000000000000000000000000800"]
};
