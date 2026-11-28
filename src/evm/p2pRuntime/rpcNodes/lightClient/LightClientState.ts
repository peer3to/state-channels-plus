import { NotLocalError } from "./LightClientUnavailableError";
import type {
    AccountStateRead,
    ProvenAccountState
} from "./proof/AProvenStateReader";
import {
    AccountCache,
    CacheType,
    RPCStateManager,
    StorageCache
} from "@ethereumjs/statemanager";
import { Account, type Address } from "@ethereumjs/util";
import { getBytes, hexlify, keccak256 } from "ethers";

/** Keccak-256 of empty code, the code hash of an account without code. */
const EMPTY_CODE_HASH = getBytes(keccak256("0x"));

/** Entries the call's write caches hold; the base class uses the same size. */
const CALL_CACHE_SIZE = 100000;

/**
 * Stands in for the provider URL `RPCStateManager` insists on: every read
 * that would use it is overridden here.
 */
const UNUSED_PROVIDER_URL = "http://light-client.invalid";

/** A lowercase 0x-prefixed account address. */
type AccountAddress = string;
/** A 32-byte storage slot index as lowercase 0x-prefixed hex. */
type StorageSlotKey = string;

/** One account as proven so far; absent fields are not proven yet. */
type HeldAccount = {
    balance?: bigint;
    nonce?: bigint;
    code?: Uint8Array;
    /** Proven 32-byte words, zero included. */
    storage: Map<StorageSlotKey, Uint8Array>;
    /** What of it a node proved on request, rather than a pushed partition. */
    fromNode: {
        account: boolean;
        code: boolean;
        slots: Set<StorageSlotKey>;
    };
};

export type LightClientStateOptions = {
    /**
     * Whether `address` is served by the local EVM itself (a precompile):
     * its account is empty and never read from the chain.
     */
    isLocalOnly: (address: AccountAddress) => boolean;
    /**
     * Whether the chain answers calls to `address` with a precompile of its
     * own that the local EVM does not reproduce.
     */
    isNodeOnly: (address: AccountAddress) => boolean;
};

/**
 * The local EVM's state: what was proven of the chain's state at one block,
 * kept in `accounts`. The inherited caches hold only what the running call
 * itself writes; the caller discards them after each call, so the proven
 * state is never touched.
 *
 * Missing state is not fetched here. A read of it answers a placeholder and
 * records what was missing; the caller has all of it proven at once
 * ({@link takeMisses}, {@link fill}) and runs the pass again.
 */
export class LightClientState extends RPCStateManager {
    private readonly isLocalOnly: (address: AccountAddress) => boolean;
    private readonly isNodeOnly: (address: AccountAddress) => boolean;
    /** The proven chain state; the inherited caches are only the call's writes. */
    private readonly accounts = new Map<AccountAddress, HeldAccount>();
    /** What the running pass found missing, by address. */
    private readonly misses = new Map<AccountAddress, AccountStateRead>();
    /**
     * The code the call had created at each open checkpoint, by the address
     * string the base keys it with: a revert goes back to it.
     */
    private createdCodeCheckpoints: Map<string, Uint8Array>[] = [];
    /** Whether a read since {@link takeUsedNodeProof} used state a node proved on request. */
    private hasUsedNodeProof = false;

    constructor(options: LightClientStateOptions) {
        super({ provider: UNUSED_PROVIDER_URL, blockTag: 0n });
        this.isLocalOnly = options.isLocalOnly;
        this.isNodeOnly = options.isNodeOnly;
    }

    // Overrides RPCStateManager.setBlockTag: the block moves by forgetting
    // the proven state, which the caller does; the base would clear the
    // call's caches too.
    override setBlockTag(): void {
        // nothing to do: reads are made at the block the state was proven at
    }

    // Overrides RPCStateManager.clearCaches: also forgets the proven state.
    override clearCaches(): void {
        super.clearCaches();
        this.accounts.clear();
        this.misses.clear();
    }

    // Overrides RPCStateManager.shallowCopy: a copy would read through the
    // unused provider URL.
    override shallowCopy(): never {
        throw new Error("The light client state cannot be copied");
    }

    // Overrides RPCStateManager.getContractStorage: the call's own writes,
    // then the proven state; a slot not proven yet answers zero and is
    // recorded as missing.
    override async getContractStorage(
        address: Address,
        key: Uint8Array
    ): Promise<Uint8Array> {
        if (key.length !== 32)
            throw new Error("Storage key must be 32 bytes long");
        const written = this._storageCache.get(address, key);
        if (written !== undefined) return written;
        const accountAddress = toAccountAddress(address);
        this.assertRunsHere(accountAddress);
        const slot = hexlify(key);
        const account = this.accountOf(accountAddress);
        const known = account.storage.get(slot);
        if (known !== undefined) {
            if (account.fromNode.slots.has(slot)) this.hasUsedNodeProof = true;
            return known;
        }
        const missingSlots = this.missing(accountAddress).slots;
        if (!missingSlots.includes(slot)) missingSlots.push(slot);
        return new Uint8Array(32);
    }

    // Overrides RPCStateManager.getAccount: the call's own writes, then the
    // proven nonce, balance and code; the base would ask eth_getProof.
    override async getAccount(address: Address): Promise<Account | undefined> {
        const written = this._accountCache.get(address);
        if (written !== undefined)
            return written.accountRLP !== undefined
                ? Account.fromRlpSerializedAccount(written.accountRLP)
                : undefined;
        const accountAddress = toAccountAddress(address);
        if (this.isLocalOnly(accountAddress)) return undefined;
        this.assertRunsHere(accountAddress);
        const account = this.accountOf(accountAddress);
        this.noteAccountRead(accountAddress, account);
        if (account.code === undefined)
            this.missing(accountAddress).code = true;
        else if (account.fromNode.code) this.hasUsedNodeProof = true;
        const balance = account.balance ?? 0n;
        const nonce = account.nonce ?? 0n;
        const code = account.code ?? new Uint8Array();
        if (balance === 0n && nonce === 0n && code.length === 0)
            return undefined;
        return Account.fromAccountData({
            balance,
            nonce,
            codeHash:
                code.length === 0 ? EMPTY_CODE_HASH : getBytes(keccak256(code))
        });
    }

    // Overrides RPCStateManager.accountExists: the base would ask eth_getProof.
    override async accountExists(address: Address): Promise<boolean> {
        return (await this.getAccount(address)) !== undefined;
    }

    // Overrides RPCStateManager.getContractCode: code the call created, then
    // the chain's; code not proven yet answers empty and is recorded as missing.
    override async getContractCode(address: Address): Promise<Uint8Array> {
        const created = this._contractCache.get(address.toString());
        if (created !== undefined) return created;
        const accountAddress = toAccountAddress(address);
        this.assertRunsHere(accountAddress);
        return this.readCode(accountAddress) ?? new Uint8Array();
    }

    // Overrides RPCStateManager.checkpoint: also keeps the code the call has
    // created so far, which the base's checkpoints do not cover.
    override async checkpoint(): Promise<void> {
        this.createdCodeCheckpoints.push(new Map(this._contractCache));
        await super.checkpoint();
    }

    // Overrides RPCStateManager.commit: the created code stays.
    override async commit(): Promise<void> {
        this.createdCodeCheckpoints.pop();
        await super.commit();
    }

    // Overrides RPCStateManager.revert: the base forgets all created code,
    // also what an outer frame created; this goes back to the checkpoint's.
    override async revert(): Promise<void> {
        const created = this.createdCodeCheckpoints.pop();
        await super.revert();
        this._contractCache = created ?? new Map();
    }

    // Overrides RPCStateManager.getProof: the base would ask eth_getProof.
    override async getProof(): Promise<never> {
        throw new Error("The light client state serves no Ethereum proof");
    }

    /** The code of `address` as proven; empty and recorded as missing if not proven yet. */
    readCodeOf(address: Address): Uint8Array {
        return this.readCode(toAccountAddress(address)) ?? new Uint8Array();
    }

    /** The nonce and balance of `address` as proven; zero and recorded as missing if not proven yet. */
    readAccountOf(address: Address): { nonce: bigint; balance: bigint } {
        const accountAddress = toAccountAddress(address);
        const account = this.accountOf(accountAddress);
        this.noteAccountRead(accountAddress, account);
        return { nonce: account.nonce ?? 0n, balance: account.balance ?? 0n };
    }

    /** What the pass found missing; the next pass starts with none. */
    takeMisses(): AccountStateRead[] {
        const taken = [...this.misses.values()];
        this.misses.clear();
        return taken;
    }

    /**
     * Stores what was proven for `reads`: `proven[i]` answers `reads[i]`.
     * `fromNode` is whether a node proved it on request, rather than a
     * pushed partition.
     */
    fill(
        reads: AccountStateRead[],
        proven: ProvenAccountState[],
        fromNode: boolean
    ): void {
        reads.forEach((read, index) => {
            const account = this.accountOf(read.address);
            const answer = proven[index];
            read.slots.forEach((slot, slotIndex) => {
                const key = hexlify(slot);
                account.storage.set(key, getBytes(answer.storage[slotIndex]));
                if (fromNode) account.fromNode.slots.add(key);
                else account.fromNode.slots.delete(key);
            });
            if (answer.account) {
                account.nonce = answer.account.nonce;
                account.balance = answer.account.balance;
                account.fromNode.account = fromNode;
            }
            if (answer.code !== undefined) {
                account.code = getBytes(answer.code);
                account.fromNode.code = fromNode;
            }
        });
    }

    /** Whether a read since the last call used state a node proved on request. */
    takeUsedNodeProof(): boolean {
        const hasUsed = this.hasUsedNodeProof;
        this.hasUsedNodeProof = false;
        return hasUsed;
    }

    /** Forgets the proven state: it held at another block. */
    forgetProvenState(): void {
        this.accounts.clear();
        this.misses.clear();
    }

    /**
     * Drops what the last call wrote. The caches are replaced, not reverted:
     * a call that stopped halfway leaves checkpoints a revert would miss.
     */
    resetCallWrites(): void {
        this._storageCache = new StorageCache({
            size: CALL_CACHE_SIZE,
            type: CacheType.ORDERED_MAP
        });
        this._accountCache = new AccountCache({
            size: CALL_CACHE_SIZE,
            type: CacheType.ORDERED_MAP
        });
        this._contractCache = new Map();
        this.createdCodeCheckpoints = [];
        this.originalStorageCache.clear();
    }

    // The proven code, or undefined with the code recorded as missing.
    private readCode(address: AccountAddress): Uint8Array | undefined {
        const account = this.accountOf(address);
        if (account.code === undefined) this.missing(address).code = true;
        else if (account.fromNode.code) this.hasUsedNodeProof = true;
        return account.code;
    }

    // Records the nonce and balance of `account` as missing, or as used.
    private noteAccountRead(
        address: AccountAddress,
        account: HeldAccount
    ): void {
        if (account.balance === undefined || account.nonce === undefined)
            this.missing(address).account = true;
        else if (account.fromNode.account) this.hasUsedNodeProof = true;
    }

    // An address the chain answers with its own precompile is not run here.
    private assertRunsHere(address: AccountAddress): void {
        if (this.isNodeOnly(address))
            throw new NotLocalError(`${address} is a chain precompile`);
    }

    private accountOf(address: AccountAddress): HeldAccount {
        let account = this.accounts.get(address);
        if (!account) {
            account = {
                storage: new Map(),
                fromNode: { account: false, code: false, slots: new Set() }
            };
            this.accounts.set(address, account);
        }
        return account;
    }

    private missing(address: AccountAddress): AccountStateRead {
        let miss = this.misses.get(address);
        if (!miss) {
            miss = { address, slots: [], account: false, code: false };
            this.misses.set(address, miss);
        }
        return miss;
    }
}

function toAccountAddress(address: Address): AccountAddress {
    return address.toString().toLowerCase();
}
