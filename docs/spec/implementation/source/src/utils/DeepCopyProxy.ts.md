# DeepCopyProxy.ts

> **Source:** [src/utils/DeepCopyProxy.ts](../../../../../../src/utils/DeepCopyProxy.ts)

## Requirements

- [`REQ-STOR-6-SKP0KM` (Value semantics at the store boundary)](../../../../specification/storage/durability.md#req-stor-6-skp0km)
- [`REQ-IX-9-AV56NR` (Storage fidelity)](../../../../specification/interactions.md#req-ix-9-av56nr)

## UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ

Copy semantics

- Setup: Mutate returned/stored objects through wrapped modules
- Oracle: No aliasing in either direction; nested structures copied

- [ ] `UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P1` — result mutation isolated
- [ ] `UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P2` — input mutation isolated
- [ ] `UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P3` — nested handling
- [ ] `UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P4` — cyclic handling
- [x] `UNIT-TEST-DEEP-COPY-PROXY-1-WWX3NZ.P5` — a wrapped method returning a generator: the generator still works lazily and each yielded value is isolated from store state
