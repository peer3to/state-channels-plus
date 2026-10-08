# logStore.ts

> **Source:** [src/utils/logging/logStore.ts](../../../../../../../src/utils/logging/logStore.ts)
>
> **Design views:** [architecture/sdk/components.md](../../../../views/architecture/sdk/components.md)

## Requirements

- [`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)
- [`REQ-LOG-5-ST6S0G` (Sending twice does not store twice)](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)
- [`REQ-LOG-6-Q8KY4N` (One run's logs never overwrite another's)](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)

## UNIT-TEST-LOG-STORE-1-279Z99

The buffer's sequence and delta semantics.

- Setup: Construct a store with a small bound; store past it; read deltas past several cursors.
- Oracle: Sequence numbers monotonic; delta range and entries consistent; nothing kept past the bound.

- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P1` — sequence numbers stay monotonic across eviction
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P2` — a delta holds only entries past the cursor
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P3` — an empty delta leaves the cursor where it was
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P4` — a delta whose start jumped past the cursor shows the gap
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P5` — the store id is 64 random bits no two stores share
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P6` — An infinite store limit rejects
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P7` — An oversized entry is evicted
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P8` — A zero limit retains no entries
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P9` — A NaN store limit rejects
- [x] `UNIT-TEST-LOG-STORE-1-279Z99.P10` — A negative store limit rejects
