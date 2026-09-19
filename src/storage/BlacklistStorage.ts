import { Address } from "@/types/types";
import { getChecksumAddress } from "@/utils/address";

/** Why an identity was blacklisted, as the call site stated it. */
export type BlacklistReason = string;

export type BlacklistEntry = {
    address: Address;
    reason: BlacklistReason;
};

/**
 * The recorded blacklist verdicts, keyed by checksummed EVM address. In memory
 * like every other store today; the persisted shape is the address and the
 * reason, so a disk backend carries it unchanged. Loading it at start and
 * banning the recorded handles is future work.
 */
export class BlacklistStorage {
    // Keys are checksummed EVM addresses; values are the reason recorded with
    // the first verdict against that address.
    private readonly reasonsByAddress = new Map<Address, BlacklistReason>();

    /** Records the verdict; a later verdict keeps the first reason. */
    record(address: Address, reason: BlacklistReason): boolean {
        const key = getChecksumAddress(address);
        if (this.reasonsByAddress.has(key)) return false;
        this.reasonsByAddress.set(key, reason);
        return true;
    }

    remove(address: Address): boolean {
        return this.reasonsByAddress.delete(getChecksumAddress(address));
    }

    has(address: Address): boolean {
        return this.reasonsByAddress.has(getChecksumAddress(address));
    }

    get(address: Address): BlacklistEntry | undefined {
        const key = getChecksumAddress(address);
        const reason = this.reasonsByAddress.get(key);
        return reason === undefined ? undefined : { address: key, reason };
    }

    entries(): BlacklistEntry[] {
        return [...this.reasonsByAddress].map(([address, reason]) => ({
            address,
            reason
        }));
    }

    clear(): void {
        this.reasonsByAddress.clear();
    }
}
