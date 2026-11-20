// @spec-test-coverage-ignore: one-entry tries for the Frontier account verifier's checks; executable evidence belongs to its calling test declarations
import { rootOfSingleNodeTrie, singleLeafNode } from "./craftedTrieNodes";
import type FrontierAccountProofVerifier from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierAccountProofVerifier";
import {
    accountCodeKey,
    systemAccountKey
} from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import type { ChecksumAddress } from "@/types/types";

/** The account `verifier` proves for `address` from a trie that holds only `encodedAccount`. */
export function accountFromSingleEntryTrie(
    verifier: FrontierAccountProofVerifier,
    address: ChecksumAddress,
    encodedAccount: string
) {
    const node = singleLeafNode(systemAccountKey(address), encodedAccount);
    return verifier.provenAccount(rootOfSingleNodeTrie(node), address, [node]);
}

/** The code `verifier` proves for `address` from a trie that holds only `encodedCode`. */
export function codeFromSingleEntryTrie(
    verifier: FrontierAccountProofVerifier,
    address: ChecksumAddress,
    encodedCode: string
) {
    const node = singleLeafNode(accountCodeKey(address), encodedCode);
    return verifier.provenCode(rootOfSingleNodeTrie(node), address, [node]);
}
