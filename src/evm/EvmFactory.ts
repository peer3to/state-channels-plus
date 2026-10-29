import { CONSOLE_ADDRESS, createConsolePrecompile } from "./ConsolePrecompile";
import {
    resolveCustomPrecompiles,
    type EvmCustomPrecompile
} from "./EvmCustomPrecompiles";
import { installEcrecoverCache } from "@/cache/EcrecoverCache";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import type { Logger } from "@/utils";
import { EVM, EVMOpts } from "@ethereumjs/evm";
import { DefaultStateManager } from "@ethereumjs/statemanager";
import { Trie } from "@ethereumjs/trie";
import { Address } from "@ethereumjs/util";
import { installEvmJumpdestCache } from "@platform/evmJumpdestCache";

export interface EvmFactoryOptions extends Omit<EVMOpts, "customPrecompiles"> {
    customPrecompiles?: EvmCustomPrecompile[];
}

export async function createEvm(
    options: EvmFactoryOptions = {},
    logger: Logger,
    owner?: AInternalRpcRoot
): Promise<EVM> {
    const consoleAddress = Address.fromString(CONSOLE_ADDRESS);
    const { customPrecompiles: inputCustomPrecompiles, ...evmOptions } =
        options;

    const existingPrecompiles = await resolveCustomPrecompiles(
        inputCustomPrecompiles,
        logger,
        owner
    );
    const customPrecompiles = [
        ...existingPrecompiles,
        {
            address: consoleAddress,
            function: createConsolePrecompile(logger)
        }
    ];

    // See TODO(evm-upgrade) in ContractExecutor: v10 still re-scans per call,
    // so the cache is the fix regardless of the package version.
    installEvmJumpdestCache();
    const evm = await EVM.create({
        stateManager: createPrunedStateManager(),
        ...evmOptions,
        customPrecompiles
    });
    installEcrecoverCache(evm);

    return evm;
}

/**
 * The EVM's default state manager keeps every trie node it ever wrote: each
 * storage write adds new nodes and the replaced ones stay in the in-memory
 * database, so a long channel grows the thread's heap by every block until it
 * runs out of memory. Node pruning deletes the replaced nodes. Storage tries
 * share the account trie's database and copy its options, so each one gets
 * its own key prefix: pruning one trie must never delete a node another trie
 * still references. No caller switches back to an older state root, which
 * pruning makes impossible.
 */
function createPrunedStateManager(): DefaultStateManager {
    return new DefaultStateManager({
        trie: new Trie({ useKeyHashing: true, useNodePruning: true }),
        prefixStorageTrieKeys: true
    });
}

export default createEvm;
