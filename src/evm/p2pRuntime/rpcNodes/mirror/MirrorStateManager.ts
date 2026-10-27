import type {
    AccountAddress,
    AccountDiff,
    BlockStorageDiff,
    StorageSlot
} from "@/utils/node/storageDiff/blockStorageDiff";
import {
    AccountCache,
    CacheType,
    RPCStateManager,
    StorageCache
} from "@ethereumjs/statemanager";
import { Account, type Address, setLengthLeft } from "@ethereumjs/util";
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

/** What the mirror reads from the RPC node on a cache miss. */
export interface MirrorUpstream {
    getStorageAt(
        address: AccountAddress,
        slot: StorageSlot,
        block: bigint
    ): Promise<string>;
    getBalance(address: AccountAddress, block: bigint): Promise<string>;
    getTransactionCount(
        address: AccountAddress,
        block: bigint
    ): Promise<string>;
    getCode(address: AccountAddress, block: bigint): Promise<string>;
}

/** A read reached an address the storage diff service is not following. */
export class UntrackedAddressError extends Error {
    readonly address: AccountAddress;

    constructor(address: AccountAddress) {
        super(`Address ${address} is not tracked by the mirror`);
        this.address = address;
    }
}

/** One account as the mirror knows it; absent fields are not cached yet. */
type MirrorAccount = {
    balance?: bigint;
    nonce?: bigint;
    code?: Uint8Array;
    /** Known 32-byte words, zero included. */
    storage: Map<StorageSlot, Uint8Array>;
};

export type MirrorStateManagerOptions = {
    upstream: MirrorUpstream;
    /** Whether the storage diff service follows `address`. */
    isTracked: (address: AccountAddress) => boolean;
    /**
     * Whether `address` is served by the local EVM itself (a precompile):
     * its account is empty and never read upstream.
     */
    isLocalOnly: (address: AccountAddress) => boolean;
};

/**
 * The local EVM's state: the chain's state at the mirror's head, kept in
 * `accounts` and fed by the storage diff service and by RPC reads on a miss.
 * The inherited caches hold only what the running call itself writes; the
 * caller reverts them after each call, so the chain state is never touched.
 */
export class MirrorStateManager extends RPCStateManager {
    private readonly upstream: MirrorUpstream;
    private readonly isTracked: (address: AccountAddress) => boolean;
    private readonly isLocalOnly: (address: AccountAddress) => boolean;
    /** The chain state; the inherited caches are only the call's writes. */
    private readonly accounts = new Map<AccountAddress, MirrorAccount>();
    /** The block number every miss is read at. */
    private head = 0n;

    constructor(options: MirrorStateManagerOptions) {
        super({ provider: UNUSED_PROVIDER_URL, blockTag: 0n });
        this.upstream = options.upstream;
        this.isTracked = options.isTracked;
        this.isLocalOnly = options.isLocalOnly;
    }

    // Overrides RPCStateManager.setBlockTag: the head moves by applying the
    // block's diff, so the cache is kept instead of cleared. Only the block
    // number misses are read at changes.
    override setBlockTag(blockTag: bigint | "earliest"): void {
        if (blockTag === "earliest")
            throw new Error("The mirror reads at its head, not at earliest");
        this.head = blockTag;
    }

    // Overrides RPCStateManager.clearCaches: also forgets the chain state.
    override clearCaches(): void {
        super.clearCaches();
        this.accounts.clear();
    }

    // Overrides RPCStateManager.shallowCopy: a copy would read through the
    // unused provider URL.
    override shallowCopy(): never {
        throw new Error("The mirror state manager cannot be copied");
    }

    // Overrides RPCStateManager.getContractStorage: the call's own writes,
    // then the chain state, then one `eth_getStorageAt` at the head.
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
        const slot = hexlify(key);
        const account = this.accountOf(accountAddress);
        const known = account.storage.get(slot);
        if (known !== undefined) return known;
        this.assertTracked(accountAddress);
        const word = setLengthLeft(
            getBytes(
                await this.upstream.getStorageAt(
                    accountAddress,
                    slot,
                    this.head
                )
            ),
            32
        );
        // no block was applied while this read waited, so no diff holds a
        // newer value for the slot
        account.storage.set(slot, word);
        return word;
    }

    // Overrides RPCStateManager.getAccount: the call's own writes, then the
    // chain state, read as balance, nonce and code because the node has no
    // eth_getProof.
    override async getAccount(address: Address): Promise<Account | undefined> {
        const written = this._accountCache.get(address);
        if (written !== undefined)
            return written.accountRLP !== undefined
                ? Account.fromRlpSerializedAccount(written.accountRLP)
                : undefined;
        const accountAddress = toAccountAddress(address);
        if (this.isLocalOnly(accountAddress)) return undefined;
        const { balance, nonce, code } = await this.loadAccount(accountAddress);
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
    // the chain's, fetched once.
    override async getContractCode(address: Address): Promise<Uint8Array> {
        const created = this._contractCache.get(address.toString());
        if (created !== undefined) return created;
        const accountAddress = toAccountAddress(address);
        if (this.isLocalOnly(accountAddress)) return new Uint8Array();
        return (await this.loadAccount(accountAddress)).code;
    }

    // Overrides RPCStateManager.getProof: the node has no eth_getProof.
    override async getProof(): Promise<never> {
        throw new Error("The mirror cannot prove state");
    }

    /** Applies one block's changes to the cached chain state. */
    applyBlock(record: BlockStorageDiff): void {
        for (const [address, post] of Object.entries(record.post)) {
            const account = this.accountOf(address);
            this.setFields(account, post, post);
            for (const [slot, word] of Object.entries(post.storage ?? {}))
                account.storage.set(slot, getBytes(word));
        }
        this.head = BigInt(record.number);
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
        this.head = BigInt(record.number) - 1n;
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

    /** Forgets everything cached for `address`. */
    forget(address: AccountAddress): void {
        this.accounts.delete(address);
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

    private accountOf(address: AccountAddress): MirrorAccount {
        let account = this.accounts.get(address);
        if (!account) {
            account = { storage: new Map() };
            this.accounts.set(address, account);
        }
        return account;
    }

    private assertTracked(address: AccountAddress): void {
        if (!this.isTracked(address)) throw new UntrackedAddressError(address);
    }

    /** The account's balance, nonce and code, reading what is missing. */
    private async loadAccount(
        address: AccountAddress
    ): Promise<{ balance: bigint; nonce: bigint; code: Uint8Array }> {
        const account = this.accountOf(address);
        if (
            account.balance === undefined ||
            account.nonce === undefined ||
            account.code === undefined
        ) {
            this.assertTracked(address);
            const head = this.head;
            const [balance, nonce, code] = await Promise.all([
                account.balance === undefined
                    ? this.upstream.getBalance(address, head)
                    : undefined,
                account.nonce === undefined
                    ? this.upstream.getTransactionCount(address, head)
                    : undefined,
                account.code === undefined
                    ? this.upstream.getCode(address, head)
                    : undefined
            ]);
            if (balance !== undefined) account.balance = BigInt(balance);
            if (nonce !== undefined) account.nonce = BigInt(nonce);
            if (code !== undefined) account.code = getBytes(code);
        }
        return {
            balance: account.balance!,
            nonce: account.nonce!,
            code: account.code!
        };
    }
}

function toAccountAddress(address: Address): AccountAddress {
    return address.toString().toLowerCase();
}
