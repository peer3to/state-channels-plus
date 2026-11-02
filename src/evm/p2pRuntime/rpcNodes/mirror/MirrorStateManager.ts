import { isNodeOnlyAddress, isPolkaVmCode } from "./LocalExecutionPolicy";
import { NotLocalError } from "./MirrorUnavailableError";
import type {
    AccountAddress,
    AccountDiff,
    AccountDiffs,
    BlockStorageDiff,
    StateRequestParams,
    StorageSlot
} from "@/utils/storageDiff/storageDiffWire";
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
const UNUSED_PROVIDER_URL = "http://mirror.invalid";

/** One account as the mirror knows it; absent fields are not cached yet. */
type MirrorAccount = {
    /** Every slot it ever wrote is in `storage`: a slot not there reads as zero. */
    complete?: boolean;
    balance?: bigint;
    nonce?: bigint;
    code?: Uint8Array;
    /** Known 32-byte words, zero included. */
    storage: Map<StorageSlot, Uint8Array>;
};

export type MirrorStateManagerOptions = {
    /**
     * Whether `address` is served by the local EVM itself (a precompile):
     * its account is empty and never read from the service.
     */
    isLocalOnly: (address: AccountAddress) => boolean;
};

/**
 * The local EVM's state: the chain's state at the mirror's head, kept in
 * `accounts` and fed by the storage diff service. The inherited caches hold
 * only what the running call itself writes; the caller discards them after
 * each call, so the chain state is never touched.
 *
 * Missing state is not fetched here. A read of it answers a placeholder and
 * records what was missing; the caller reads all of it from the service at
 * once ({@link takeMisses}, {@link fill}) and runs the pass again.
 */
export class MirrorStateManager extends RPCStateManager {
    private readonly isLocalOnly: (address: AccountAddress) => boolean;
    /** The chain state; the inherited caches are only the call's writes. */
    private readonly accounts = new Map<AccountAddress, MirrorAccount>();
    /** What the running pass found missing, by address. */
    private readonly misses = new Map<AccountAddress, StateRequestParams>();

    constructor(options: MirrorStateManagerOptions) {
        super({ provider: UNUSED_PROVIDER_URL, blockTag: 0n });
        this.isLocalOnly = options.isLocalOnly;
    }

    // Overrides RPCStateManager.setBlockTag: the head moves by applying the
    // block's diff, so the cache is kept; the base would clear it.
    override setBlockTag(): void {
        // nothing to do: reads are made at the chain's head block
    }

    // Overrides RPCStateManager.clearCaches: also forgets the chain state.
    override clearCaches(): void {
        super.clearCaches();
        this.accounts.clear();
        this.misses.clear();
    }

    // Overrides RPCStateManager.shallowCopy: a copy would read through the
    // unused provider URL.
    override shallowCopy(): never {
        throw new Error("The mirror state manager cannot be copied");
    }

    // Overrides RPCStateManager.getContractStorage: the call's own writes,
    // then the chain state; a slot not cached yet answers zero and is
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
        if (this.isLocalOnly(accountAddress)) return new Uint8Array(32);
        this.assertRunsHere(accountAddress);
        const slot = hexlify(key);
        const account = this.accountOf(accountAddress);
        const known = account.storage.get(slot);
        if (known !== undefined) return known;
        if (account.complete) return new Uint8Array(32);
        this.missing(accountAddress).slots!.push(slot);
        return new Uint8Array(32);
    }

    // Overrides RPCStateManager.getAccount: the call's own writes, then the
    // chain state (balance, nonce and code), as the node has no eth_getProof.
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
        if (account.balance === undefined || account.nonce === undefined) {
            this.missing(accountAddress).account = true;
        }
        if (account.code === undefined)
            this.missing(accountAddress).code = true;
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

    // Overrides RPCStateManager.accountExists: eth_getProof is not available.
    override async accountExists(address: Address): Promise<boolean> {
        return (await this.getAccount(address)) !== undefined;
    }

    // Overrides RPCStateManager.getContractCode: code the call created, then
    // the chain's; code not cached yet answers empty and is recorded as missing.
    override async getContractCode(address: Address): Promise<Uint8Array> {
        const created = this._contractCache.get(address.toString());
        if (created !== undefined) return created;
        const accountAddress = toAccountAddress(address);
        if (this.isLocalOnly(accountAddress)) return new Uint8Array();
        this.assertRunsHere(accountAddress);
        const code = this.readCode(accountAddress);
        // PolkaVM code is no EVM code: the node runs the call
        if (code && isPolkaVmCode(code))
            throw new NotLocalError(`${accountAddress} holds PolkaVM code`);
        return code ?? new Uint8Array();
    }

    /** The code of `address` as the chain has it, whatever it is; empty and recorded as missing if not cached. */
    readCodeOf(address: Address): Uint8Array {
        const accountAddress = toAccountAddress(address);
        if (this.isLocalOnly(accountAddress)) return new Uint8Array();
        return this.readCode(accountAddress) ?? new Uint8Array();
    }

    // Overrides RPCStateManager.getProof: the node has no eth_getProof.
    override async getProof(): Promise<never> {
        throw new Error("The mirror cannot prove state");
    }

    /** What the pass found missing; the next pass starts with none. */
    takeMisses(): StateRequestParams[] {
        const taken = [...this.misses.values()];
        this.misses.clear();
        return taken;
    }

    /**
     * Makes each account in `accounts` exactly what the snapshot says, with
     * every slot it ever wrote: a slot not listed reads as zero from now on.
     */
    applySnapshot(accounts: AccountDiffs): void {
        for (const [address, diff] of Object.entries(accounts)) {
            const account: MirrorAccount = {
                complete: true,
                storage: new Map()
            };
            this.accounts.set(address, account);
            this.writeAccount(account, diff);
        }
    }

    /** Applies what `record` wrote to the accounts `addresses` only. */
    replay(record: BlockStorageDiff, addresses: AccountAddress[]): void {
        for (const address of addresses) {
            const post = record.post[address];
            if (!post) continue;
            this.writeAccount(this.accountOf(address), post);
        }
    }

    /** Of `requests`, the parts not cached: what is still to be read. */
    stillMissing(requests: StateRequestParams[]): StateRequestParams[] {
        const lacking: StateRequestParams[] = [];
        for (const request of requests) {
            const account = this.accounts.get(request.address);
            const slots = (request.slots ?? []).filter(
                (slot) => !account?.complete && !account?.storage.has(slot)
            );
            const needsAccount =
                request.account === true &&
                (account?.balance === undefined || account.nonce === undefined);
            const needsCode =
                request.code === true && account?.code === undefined;
            if (slots.length > 0 || needsAccount || needsCode)
                lacking.push({
                    address: request.address,
                    slots,
                    account: needsAccount,
                    code: needsCode
                });
        }
        return lacking;
    }

    /** Forgets everything cached of `address`: its fields are read again when needed. */
    dropToLazy(address: AccountAddress): void {
        this.accounts.delete(address);
    }

    /** Forgets the fields and slots of `address` that `diff` names. */
    forget(address: AccountAddress, diff: AccountDiff): void {
        const account = this.accounts.get(address);
        if (!account) return;
        account.complete = false;
        this.setFields(account, diff, {});
        for (const slot of Object.keys(diff.storage ?? {}))
            account.storage.delete(slot);
    }

    /** Whether `address` has its complete state cached. */
    isComplete(address: AccountAddress): boolean {
        return this.accounts.get(address)?.complete === true;
    }

    /**
     * Stores values read for the misses: a service answer, shaped like a
     * record's `post`. Applies one block's changes to the cached chain state.
     */
    fill(accounts: AccountDiffs): void {
        for (const [address, diff] of Object.entries(accounts))
            this.writeAccount(this.accountOf(address), diff);
    }

    /**
     * Undoes `record`, an applied block, as the next block back. A value
     * `pre` holds is restored; one `pre` lacks was empty before the block,
     * or unknown, and is forgotten so the next read fetches it.
     */
    revertBlock(record: BlockStorageDiff): void {
        for (const [address, post] of Object.entries(record.post)) {
            const account = this.accounts.get(address);
            if (!account) continue;
            const pre: AccountDiff = record.pre[address] ?? {};
            this.setFields(account, post, pre);
            for (const slot of Object.keys(post.storage ?? {})) {
                const word = pre.storage?.[slot];
                if (word === undefined) account.storage.delete(slot);
                else account.storage.set(slot, getBytes(word));
            }
        }
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
        this.originalStorageCache.clear();
    }

    /** Sets `account`'s scalar fields and storage words from `diff`. */
    private writeAccount(account: MirrorAccount, diff: AccountDiff): void {
        this.setFields(account, diff, diff);
        for (const [slot, word] of Object.entries(diff.storage ?? {}))
            account.storage.set(slot, getBytes(word));
    }

    /**
     * Sets `account`'s scalar fields from `source` where `post` names them;
     * a field `source` lacks is forgotten.
     */
    private setFields(
        account: MirrorAccount,
        post: AccountDiff,
        source: AccountDiff
    ): void {
        if (post.balance !== undefined)
            account.balance =
                source.balance === undefined
                    ? undefined
                    : BigInt(source.balance);
        if (post.nonce !== undefined)
            account.nonce =
                source.nonce === undefined ? undefined : BigInt(source.nonce);
        if (post.code !== undefined)
            account.code =
                source.code === undefined ? undefined : getBytes(source.code);
    }

    // The cached code, or undefined with the code recorded as missing.
    private readCode(address: AccountAddress): Uint8Array | undefined {
        const code = this.accountOf(address).code;
        if (code === undefined) this.missing(address).code = true;
        return code;
    }

    // An address the chain answers with its own precompile is not run here.
    private assertRunsHere(address: AccountAddress): void {
        if (isNodeOnlyAddress(getBytes(address)))
            throw new NotLocalError(`${address} is a chain precompile`);
    }

    private accountOf(address: AccountAddress): MirrorAccount {
        let account = this.accounts.get(address);
        if (!account) {
            account = { storage: new Map() };
            this.accounts.set(address, account);
        }
        return account;
    }

    private missing(address: AccountAddress): StateRequestParams {
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
