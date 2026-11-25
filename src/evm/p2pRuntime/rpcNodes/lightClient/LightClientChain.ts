import type AProvenStateReader from "./proof/AProvenStateReader";
import type { NodeRequest, WatchRequest } from "./proof/AProvenStateReader";
import type APushedPartition from "./proof/APushedPartition";
import { PEER3_CHAIN_CONSTANTS } from "./proof/substrate/FrontierChainConstants";
import FrontierProvenStateReader from "./proof/substrate/FrontierProvenStateReader";
import FrontierPushedPartition from "./proof/substrate/FrontierPushedPartition";

/** What the light client must know of the chain its nodes serve. */
export type LightClientChain = {
    /**
     * The reader of the chain's proof representation, over requests to a
     * node and, where a subscription takes them, watches of the keys it proves.
     */
    createReader: (
        requestNode: NodeRequest,
        watch?: WatchRequest
    ) => AProvenStateReader;
    /** A partition of the chain's proof representation, for one subscription. */
    createPartition: () => APushedPartition;
    /**
     * Addresses the chain answers with a precompile of its own that a local
     * EVM does not reproduce, lowercase. A call that reaches one runs on the
     * node.
     */
    chainPrecompiles: readonly string[];
    /** The Ethereum hardfork whose rules the chain's EVM runs, as `@ethereumjs/common` names it. */
    hardfork: string;
    /**
     * The addresses of Ethereum's precompiles the chain serves, lowercase.
     * The local EVM runs no other: an address the hardfork adds a precompile
     * at is a plain account on the chain.
     */
    ethereumPrecompiles: readonly string[];
    /** How long the chain takes to make a block: the longest a read waits for a push. */
    blockTimeMs: number;
};

/**
 * The peer3 chain (`zero-fee-runtime`, peer3-parachain at d845dbfb): a
 * Frontier chain whose runtime adds the XCM precompile to Ethereum's
 * precompiles 1 to 9 (`runtime/src/precompiles.rs`), on Frontier's EVM rules
 * (`EVM_CONFIG = Config::osaka()` in `primitives/evm/src/lib.rs` at Frontier
 * 24fcbdb1). The local EVM's Common knows no hardfork after Prague: an opcode
 * only Osaka has fails locally, and a call that fails without reverting goes
 * to the node. A runtime upgrade that changes either must change these too.
 */
export const PEER3_LIGHT_CLIENT_CHAIN: LightClientChain = {
    createReader: (requestNode, watch) =>
        new FrontierProvenStateReader(
            requestNode,
            PEER3_CHAIN_CONSTANTS,
            watch
        ),
    createPartition: () => new FrontierPushedPartition(PEER3_CHAIN_CONSTANTS),
    chainPrecompiles: ["0x0000000000000000000000000000000000000800"],
    hardfork: "prague",
    ethereumPrecompiles: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(
        (index) => `0x${index.toString(16).padStart(40, "0")}`
    ),
    blockTimeMs: 2_000
};
