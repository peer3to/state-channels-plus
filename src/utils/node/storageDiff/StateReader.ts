import {
    NOT_RETAINED_ERROR_CODE,
    rpcError,
    type AccountDiffs,
    type StagedBlock
} from "./blockStorageDiff";
import { HeadChangedError, RECONCILE_RETRY_LIMIT } from "./retryPolicy";
import { type StateRequest } from "./rpcParams";
import {
    normalizeBalance,
    StateCache,
    type StateField,
    type StateValue
} from "./StateCache";
import { UpstreamLostError, type UpstreamRpcClient } from "./UpstreamRpcClient";
import type { StorageDiffState } from "../../storageDiff/storageDiffWire";

/** Identifies one state fetch in flight: a `StateField` as text. */
type FlightKey = string;

/** What a state reader uses of the service whose history and cache it reads. */
export interface StateReaderOptions {
    /** The canonical history, oldest first; it is replaced as the service loads it. */
    canonical: () => StagedBlock[];
    stateCache: StateCache;
    upstream: () => UpstreamRpcClient | undefined;
    request: (method: string, params: unknown[]) => Promise<unknown>;
    retryTransient: <T>(job: () => Promise<T>, message: string) => Promise<T>;
    retainedIndex: (blockHash: string) => number;
    /** Starts keeping the values of an account in every record. */
    watch: (address: string) => Promise<void>;
}

/** Answers `scp_getState` from the shared cache, fetching what it lacks once. */
export class StateReader {
    private readonly canonical: () => StagedBlock[];
    private readonly stateCache: StateCache;
    private readonly upstream: () => UpstreamRpcClient | undefined;
    private readonly request: (
        method: string,
        params: unknown[]
    ) => Promise<unknown>;
    private readonly retryTransient: <T>(
        job: () => Promise<T>,
        message: string
    ) => Promise<T>;
    private readonly retainedIndex: (blockHash: string) => number;
    private readonly watch: (address: string) => Promise<void>;
    // One fetch per missing field, shared by every reader waiting for it.
    private readonly flights = new Map<FlightKey, Promise<void>>();

    constructor(options: StateReaderOptions) {
        this.canonical = options.canonical;
        this.stateCache = options.stateCache;
        this.upstream = options.upstream;
        this.request = options.request;
        this.retryTransient = options.retryTransient;
        this.retainedIndex = options.retainedIndex;
        this.watch = options.watch;
    }

    /**
     * The values of the requested fields at retained block `blockHash`.
     * A field missing from the cache is fetched from the upstream once, at the
     * best head, however many readers wait for it; an older block is answered
     * by undoing the later blocks' writes with their `pre` values.
     */
    async getState(
        blockHash: string,
        requests: StateRequest[]
    ): Promise<StorageDiffState> {
        const fields = requests.flatMap((request) => this.fieldsOf(request));
        // the records hold the requested accounts, which a value read needs
        await Promise.all(
            requests.map((request) => this.watch(request.address))
        );
        for (let attempt = 0; attempt <= RECONCILE_RETRY_LIMIT; attempt++) {
            this.assertRetained(blockHash);
            this.fetchMissing(fields);
            await Promise.all(fields.map((field) => this.ensureCached(field)));
            // Synchronous from here: the cache and the chain agree.
            const index = this.retainedIndex(blockHash);
            if (index < 0) continue;
            const heads = fields.map((field) => this.stateCache.get(field));
            if (heads.some((value) => value === undefined)) continue;
            const scratch = new StateCache();
            fields.forEach((field, i) => scratch.set(field, heads[i]!));
            for (let i = this.canonical().length - 1; i > index; i--) {
                scratch.applyBackward(this.canonical()[i]);
            }
            const block = this.canonical()[index];
            return {
                number: block.number,
                hash: block.hash,
                accounts: this.accountsOf(requests, fields, scratch)
            };
        }
        throw new HeadChangedError("The chain moved while state was read");
    }

    private assertRetained(blockHash: string): void {
        if (this.retainedIndex(blockHash) < 0) {
            throw rpcError(NOT_RETAINED_ERROR_CODE, "Block is not retained");
        }
    }

    private fieldsOf(request: StateRequest): StateField[] {
        const { address } = request;
        return [
            ...request.slots.map(
                (slot): StateField => ({
                    kind: "slot",
                    address,
                    slot
                })
            ),
            ...(request.account
                ? [
                      { kind: "balance", address } as const,
                      { kind: "nonce", address } as const
                  ]
                : []),
            ...(request.code ? [{ kind: "code", address } as const] : [])
        ];
    }

    private accountsOf(
        requests: StateRequest[],
        fields: StateField[],
        values: StateCache
    ): AccountDiffs {
        const accounts: AccountDiffs = {};
        for (const request of requests) accounts[request.address] ??= {};
        for (const field of fields) {
            const account = accounts[field.address];
            const value = values.get(field)!;
            if (field.kind === "slot") {
                (account.storage ??= {})[field.slot] = value as string;
            } else if (field.kind === "nonce") {
                account.nonce = value as number;
            } else {
                account[field.kind] = value as string;
            }
        }
        return accounts;
    }

    /**
     * Starts one batched upstream request for every field that is neither
     * cached nor being fetched, so a read of many fields is one round trip.
     * Each field gets its own flight, which settles from the batch answer.
     */
    private fetchMissing(fields: StateField[]): void {
        const pinned = this.canonical()[this.canonical().length - 1].hash;
        const missing = new Map<FlightKey, StateField>();
        for (const field of fields) {
            const key: FlightKey = JSON.stringify(field);
            if (
                this.stateCache.get(field) === undefined &&
                !this.flights.has(key)
            )
                missing.set(key, field);
        }
        if (missing.size === 0) return;
        const entries = [...missing];
        const upstream = this.upstream();
        const answers = upstream
            ? upstream.requestBatch(
                  entries.map(([, field]) => this.fieldCall(field, pinned))
              )
            : entries.map(() =>
                  Promise.reject(new UpstreamLostError("Upstream is not open"))
              );
        entries.forEach(([key, field], i) => {
            const first = answers[i].then((raw) => this.parseField(field, raw));
            const flight = this.loadField(field, {
                pinned,
                value: first
            }).finally(() => this.flights.delete(key));
            this.flights.set(key, flight);
        });
    }

    /** Waits until `field` is cached, fetching it unless a fetch is running. */
    private async ensureCached(field: StateField): Promise<void> {
        if (this.stateCache.get(field) !== undefined) return;
        const key: FlightKey = JSON.stringify(field);
        let flight = this.flights.get(key);
        if (!flight) {
            flight = this.loadField(field).finally(() =>
                this.flights.delete(key)
            );
            this.flights.set(key, flight);
        }
        await flight;
    }

    /**
     * Reads `field` at the best head's hash, so the value belongs to the
     * chain the service follows. If the chain moved on meanwhile, later
     * blocks' writes are applied to it; if that block was dropped, it reads
     * again.
     */
    private async loadField(
        field: StateField,
        first?: { pinned: string; value: Promise<StateValue> }
    ): Promise<void> {
        let unused = first;
        for (let attempt = 0; attempt <= RECONCILE_RETRY_LIMIT; attempt++) {
            const pinned =
                unused?.pinned ??
                this.canonical()[this.canonical().length - 1].hash;
            // the first try is the batch's answer; a retry asks on its own
            const issued = unused;
            unused = undefined;
            const value = await this.retryTransient(
                () =>
                    issued
                        ? issued.value.catch((error) => {
                              issued.value = this.fetchField(field, pinned);
                              throw error;
                          })
                        : this.fetchField(field, pinned),
                "Retrying the state fetch"
            );
            const index = this.retainedIndex(pinned);
            if (index < 0) continue;
            const scratch = new StateCache();
            scratch.set(field, value);
            for (let i = index + 1; i < this.canonical().length; i++) {
                scratch.applyForward(this.canonical()[i]);
            }
            this.stateCache.set(field, scratch.get(field)!);
            return;
        }
        throw new HeadChangedError("The chain moved while state was fetched");
    }

    private async fetchField(
        field: StateField,
        blockHash: string
    ): Promise<StateValue> {
        const { method, params } = this.fieldCall(field, blockHash);
        return this.parseField(field, await this.request(method, params));
    }

    /** The upstream read of `field` at exactly block `blockHash` (EIP-1898). */
    fieldCall(
        field: StateField,
        blockHash: string
    ): { method: string; params: unknown[] } {
        const at = { blockHash };
        const { address } = field;
        if (field.kind === "slot") {
            return {
                method: "eth_getStorageAt",
                params: [address, field.slot, at]
            };
        }
        const method = {
            balance: "eth_getBalance",
            nonce: "eth_getTransactionCount",
            code: "eth_getCode"
        }[field.kind];
        return { method, params: [address, at] };
    }

    parseField(field: StateField, answer: unknown): StateValue {
        if (field.kind === "slot") {
            const word = answer;
            if (
                typeof word !== "string" ||
                !/^0x[0-9a-fA-F]{1,64}$/.test(word)
            ) {
                throw new Error("Malformed storage word from upstream");
            }
            return "0x" + word.slice(2).toLowerCase().padStart(64, "0");
        }
        const value = answer;
        if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
            throw new Error(`Malformed ${field.kind} from upstream`);
        }
        if (field.kind === "code") return value.toLowerCase();
        if (value === "0x")
            throw new Error(`Malformed ${field.kind} from upstream`);
        return field.kind === "balance"
            ? normalizeBalance(value)
            : Number(BigInt(value));
    }
}
