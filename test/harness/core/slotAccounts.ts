// @spec-test-coverage-ignore: per-slot account and deployer-signer support; executable evidence belongs to its calling test declarations
// Account partitioning by concurrency slot.
//
// Each slot gets SLOT_STRIDE disjoint accounts so concurrent test processes on
// a shared hardhat node never collide on nonces. E2E_SLOT_INDEX is injected by
// the parallel runner (scripts/test-e2e-parallel.js); absent → slot 0, which is
// identical to the old single-process behaviour for serial/CI runs.
//
// The pool in hardhat.config.ts (accounts.count) must cover maxConcurrent *
// SLOT_STRIDE. Keep SLOT_STRIDE in sync with that config.
import type { Address } from "@/types/types";
import {
    AbstractProvider,
    HDNodeWallet,
    NonceManager,
    type Provider,
    type TransactionRequest,
    type TransactionResponse
} from "ethers";

export const SLOT_STRIDE = 10;

/** Returns the slot index from env, validated and defaulting to 0. */
export function slotIndex(): number {
    const raw = Number(process.env.E2E_SLOT_INDEX ?? 0);
    return Number.isFinite(raw) ? raw : 0;
}

/** Maps a peer's local index (0-based within a test) to its absolute account index. */
export function slotAccountIndex(localIndex: number): number {
    return slotIndex() * SLOT_STRIDE + localIndex;
}

/**
 * Returns the absolute account index of the deployer for this slot.
 * The deployer is at the top of the stride (index STRIDE-1), keeping it
 * disjoint from participants 0..STRIDE-2.
 */
export function slotDeployerIndex(): number {
    return slotIndex() * SLOT_STRIDE + (SLOT_STRIDE - 1);
}

/**
 * One nonce counter per deployer account in this process, which talks to one
 * slot node (isolated-node tests send from their own accounts). The harness,
 * its block production and the runtime fixtures all send from the slot
 * deployer; separate counters hand out the same nonce, so one send replaces or
 * collides with another's.
 */
const deployerSigners = new Map<Address, NonceManager>();

/**
 * A NonceManager whose counter rereads the node after a failed send. Overrides
 * NonceManager.sendTransaction: the base advances its counter before the
 * broadcast, so a rejected send would leave its nonce unsent and every later
 * send queued behind the gap for the rest of the process.
 */
class SlotDeployerSigner extends NonceManager {
    override async sendTransaction(
        tx: TransactionRequest
    ): Promise<TransactionResponse> {
        try {
            return await super.sendTransaction(tx);
        } catch (error) {
            this.reset();
            throw error;
        }
    }
}

/**
 * The process-wide nonce manager of `wallet`, the slot deployer. A fixture that
 * destroyed its provider ends that manager: the next caller gets a new one on
 * its own provider, which reads the pending nonce afresh.
 */
export function slotDeployerSigner(wallet: HDNodeWallet): NonceManager {
    const address = wallet.address as Address;
    const cached = deployerSigners.get(address);
    if (cached && !isDestroyed(cached.provider)) return cached;
    const signer = new SlotDeployerSigner(wallet);
    deployerSigners.set(address, signer);
    return signer;
}

function isDestroyed(provider: Provider | null): boolean {
    return provider instanceof AbstractProvider && provider.destroyed;
}
