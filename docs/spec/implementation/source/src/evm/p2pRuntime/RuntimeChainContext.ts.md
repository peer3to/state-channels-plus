# RuntimeChainContext.ts

> **Source:** [src/evm/p2pRuntime/RuntimeChainContext.ts](../../../../../../../src/evm/p2pRuntime/RuntimeChainContext.ts)
>
> **Design views:** [architecture/sdk/runtime-and-concurrency.md](../../../../views/architecture/sdk/runtime-and-concurrency.md), [runtime/chain-observation.md](../../../../views/runtime/chain-observation.md)

## Requirements

- [`REQ-RUNTIME-1-RSM6MZ` (Transfer-safe boundary)](../../../../../specification/runtime/execution.md#req-runtime-1-rsm6mz)
- [`REQ-CHAINOBS-1-5JTHY8` (Ordered endpoint set)](../../../../../specification/runtime/chain-observation.md#req-chainobs-1-5jthy8)

## UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8

Provider cleanup

- Setup: Real runtime construction and public cleanup.
- Oracle: The provider closes, has no listeners and permits repeated destruction.

- [x] `UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P3` — Cleanup without subscriptions
- [x] `UNIT-TEST-RUNTIME-CHAIN-CLEANUP-1-3H7PT8.P4` — Cleanup with a block subscription

## UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW

Endpoint list resolution and startup

- Setup: Pure resolution of config values; real startup against private nodes behind cuttable proxies.
- Oracle: Resolved URLs equal the hand-written list in order; startup succeeds with one reachable endpoint and fails naming each when none is.

- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P1` — list unset
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P2` — list empty
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P3` — ordered list
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P4` — invalid entry
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P5` — one of two unreachable
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P6` — none reachable, endpoints named without path or query
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P7` — a silent endpoint does not delay startup
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P8` — endpoint with a fragment rejected, named by scheme and host
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P9` — endpoint with an out-of-range port rejected without its secret
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P10` — startup over a malformed endpoint opens no node
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P11` — invalid signing key opens no node
- [x] `UNIT-TEST-RUNTIME-CHAIN-URLS-1-VRHEVW.P12` — a `LOG_QUERY_MAX_BLOCKS` of zero or a fraction rejects startup and opens no node
