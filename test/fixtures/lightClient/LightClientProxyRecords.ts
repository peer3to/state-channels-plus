// @spec-test-coverage-ignore: test-owned readings of what a light client provider fixture's proxy recorded; executable evidence belongs to its calling test declarations
import { LightClientProviderFixture } from "./LightClientProviderFixture";
import { LIGHT_CLIENT_METHODS } from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import { contractStorageKey } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/frontierStateKeys";
import SubstrateHeader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/SubstrateHeader";
import type { ChecksumAddress } from "@/types/types";
import type { RecordedMessage } from "@test/fixtures/node/RpcNodeProxy";
import { getAddress, toBeHex } from "ethers";
import { ethers } from "hardhat";

/** The trie key of `slot` of `contract`, lowercase. */
export function slotKey(contract: string, slot: number): string {
    return contractStorageKey(
        getAddress(contract) as ChecksumAddress,
        toBeHex(slot, 32)
    ).toLowerCase();
}

/** The params of every `method` request the proxy forwarded, in order, with their records. */
export function requestsOf(
    records: readonly RecordedMessage[],
    method: string
): { params: unknown[]; sequence: number }[] {
    return records
        .filter((record) => record.method === method)
        .map(({ params, sequence }) => ({
            params: params as unknown[],
            sequence
        }));
}

/** The keys a watch request named, lowercase and sorted. */
export function watchedKeysOf(params: unknown[]): string[] {
    return (params[1] as string[]).map((key) => key.toLowerCase()).sort();
}

/** The Substrate hash of the newest block pushed through the fixture's proxy. */
export function newestPushedHash(fixture: LightClientProviderFixture): string {
    const pushed = fixture.proxy.sentNotifications
        .filter(({ method }) => method === LIGHT_CLIENT_METHODS.notification)
        .map(
            ({ params }) =>
                (params as { result?: { header: never } }).result?.header
        )
        .filter((header) => header !== undefined);
    return new SubstrateHeader(pushed[pushed.length - 1]).hash;
}

/** The node's read proof of `slot` of `contract` at the newest block pushed through the fixture's proxy. */
export async function readProofAt(
    fixture: LightClientProviderFixture,
    contract: string,
    slot: number
): Promise<{ at: string; proof: string[] }> {
    const at = newestPushedHash(fixture);
    const { proof } = (await fixture.node.provider.send("state_getReadProof", [
        [slotKey(contract, slot)],
        at
    ])) as { proof: string[] };
    return { at, proof };
}

/** Drops the endpoint's new heads, so that only what the test names raises the block floor. */
export function withoutNewHeads(params: unknown): unknown {
    const notified = params as { result?: { parentHash?: string } };
    return notified.result?.parentHash === undefined ? params : undefined;
}

/** How many blocks `proxy` pushed to its subscriptions. */
export function pushedCount(proxy: {
    sentNotifications: { method: string }[];
}): number {
    return proxy.sentNotifications.filter(
        ({ method }) => method === LIGHT_CLIENT_METHODS.notification
    ).length;
}

/** How many keys each proof request the provider sent asked for, in order, from `from` on. */
export function proofKeyCounts(
    fixture: LightClientProviderFixture,
    from: number
) {
    return fixture.proxy.forwardedRequests
        .slice(from)
        .filter(({ method }) => method === "state_getReadProof")
        .map(({ params }) => (params as [string[]])[0].length);
}

/** How a call ended: what it returned, or the data it reverted with. */
export function outcomeOf(call: Promise<string>) {
    return call.then(
        (returned) => ({ returned }),
        (error: { data?: string }) => ({ revertedWith: error.data })
    );
}

/** The interface of the `SimpleNumberStorage` contract the provider fixture deploys. */
export async function numberStorageInterface() {
    return (await ethers.getContractFactory("SimpleNumberStorage")).interface;
}
