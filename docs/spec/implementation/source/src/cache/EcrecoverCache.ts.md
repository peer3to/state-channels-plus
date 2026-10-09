# EcrecoverCache.ts

> **Source:** [src/cache/EcrecoverCache.ts](../../../../../../src/cache/EcrecoverCache.ts)
>
> **Design views:** [architecture/sdk/block-confirmation-pipeline.md](../../../views/architecture/sdk/block-confirmation-pipeline.md)

## Requirements

- [`REQ-MIRROR-1-XCY9CB` (Constrained equivalence)](../../../../specification/enforcement/local-mirror.md#req-mirror-1-xcy9cb)

## UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5

Memoized precompile, unchanged results

- Setup: Build an EVM with `createEvm` (memo installed) and a plain `EVM.create()`; call the ecrecover precompile (address `0x01`) with real `(digest, v, r, s)` from a random wallet; reset the memo before each case
- Oracle: The memoized EVM returns the same output and uses the same gas as the plain EVM and resolves to the wallet address; memo size counts distinct recoveries only; a failed recovery returns empty output and adds no entry; a mutated returned key never changes a later hit; the size never exceeds the bound

- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P1` — the memoized precompile returns the same output as an EVM without the memo, and that output is the signing wallet's address
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P2` — three calls with one signature return one output and keep one entry, and a second signature adds a second entry
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P3` — a signature that recovers no key (zero `r`) returns empty output and keeps no entry
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P4` — mutating the key returned by a miss or a hit does not change the key a later hit returns
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P5` — with `SIGNER_RECOVERY_CACHE_MAX` lowered, recoveries past the bound keep the size at the bound, drop the oldest first, and an evicted signature recovers the same key again
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P6` — repeated calls after a cache fill return the plain EVM's output and gas, and only the first runs a real recovery
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P7` — a high-`s` signature (accepted by the precompile, unlike the contracts' author check) returns the plain EVM's output and gas, also from a memo hit
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P8` — a `v` other than 27 or 28 returns the plain EVM's empty output and gas, runs no recovery and keeps no entry
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P9` — one gas below the precompile cost fails out of gas like the plain EVM with no recovery, the exact cost succeeds, and a memo hit is still refused below the cost
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P10` — the digest is part of the key: in a cache already holding other entries, one signature under two digests returns, on repeated calls, the plain EVM's result for each digest (a different key for the second), and runs one real recovery per digest
- [x] `UNIT-TEST-ECRECOVER-CACHE-1-S0EEQ5.P11` — the signature is part of the key: in a cache already holding other entries, two wallets' signatures under one digest return, on repeated calls, the plain EVM's result naming each wallet, and run one real recovery per signature
