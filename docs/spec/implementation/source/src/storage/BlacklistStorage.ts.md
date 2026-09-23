# BlacklistStorage.ts — Source Report

> **Source:** [src/storage/BlacklistStorage.ts](../../../../../../src/storage/BlacklistStorage.ts) > **Status:** Authored — engineer verification pending.
> **Design views:** [architecture/sdk/rpc/README.md](../../../views/architecture/sdk/rpc/README.md)

## Contents

- [Responsibility and observable boundary](#responsibility-and-observable-boundary)
- [Key design decisions](#key-design-decisions)
- [Inputs, outputs, state, and side effects](#inputs-outputs-state-and-side-effects)
- [Linked requirements](#linked-requirements)
- [Assumptions, dependencies, trust boundaries, and limits](#assumptions-dependencies-trust-boundaries-and-limits)
- [Specification adherence](#specification-adherence)
- [Specification contradictions](#specification-contradictions)
- [Missing behavior](#missing-behavior)
- [Conformance traceability](#conformance-traceability)
- [Component test obligations](#component-test-obligations)
- [Related source reports](#related-source-reports)

## Responsibility and observable boundary

The persisted blacklist verdict: one entry per checksummed EVM address holding the reason the call
site stated. `record` keeps the first reason, `remove` clears an entry, `has`/`get`/`entries` read
it, `clear` empties it. It is mounted on [Storage](./Storage.ts.md) as `blacklist` and written only
by [ProfileManager](../ProfileManager.ts.md).

## Key design decisions

1. **The record is the address and the reason, nothing else.** That is the shape a disk backend
   carries unchanged; the profile flag and the Holepunch ban are session state derived from it.
2. **First verdict wins.** A second verdict against the same address keeps the first reason, so a
   later, vaguer call site cannot overwrite the specific one.
3. **Keys are checksummed.** Every entry point normalizes with `getChecksumAddress`, so a
   case-variant address reads and removes the same entry
   ([`REQ-ID-2-F3Y8J4` (Normalized identity comparison)](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)).

## Inputs, outputs, state, and side effects

| Aspect       | Contents                                                        |
| ------------ | --------------------------------------------------------------- |
| Inputs       | Address and reason from the profile owner.                      |
| Outputs      | Presence, the entry, or the full entry list.                    |
| Owned state  | The address-to-reason map.                                      |
| Side effects | None; the profile owner bans handles and flags profiles itself. |

## Linked requirements

A file may contribute to several requirements; this report describes the contribution and never
claims complete conformance for a requirement that depends on other files.

| Source file                                                              | Specification IDs                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [BlacklistStorage.ts](../../../../../../src/storage/BlacklistStorage.ts) | [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j), [`REQ-ID-2-F3Y8J4`](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4) |

## Assumptions, dependencies, trust boundaries, and limits

- In memory like every other store today; durability across a process restart is the storage
  module's future backend, not this file's.
- Loading the recorded verdicts at start so the handles are banned before any handshake is future
  work stated in the RPC specification, not implemented here.

## Specification adherence

- The recorded verdict is persisted as identity and reason, as
  [`REQ-RPC-6-E60S4J` (Ordered ingress verification)](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j)
  requires.

## Specification contradictions

None demonstrated.

## Missing behavior

None demonstrated.

## Conformance traceability

Status enum: `Covered` | `Partial` | `Contradicts` | `Missing`. Evidence cells are structured
**Here:** / **Other files:** so each row is auditable from its links alone; genuine gaps go in the
Gap column. Audit state is file-level (Status header), never a row status.

| Requirement / invariant                                                                    | Implementation status | Evidence                                                                                                                                                                                                                                                                                      | Gap / divergence |
| ------------------------------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| [`REQ-RPC-6-E60S4J`](../../../../specification/peer-communication/rpc.md#req-rpc-6-e60s4j) | Covered               | **Here:** [`record`](../../../../../../src/storage/BlacklistStorage.ts#L24) keeps address and reason, [`remove`](../../../../../../src/storage/BlacklistStorage.ts#L31) clears it. **Other files:** [ProfileManager](../ProfileManager.ts.md) writes on a verdict and reads before admission. | None.            |
| [`REQ-ID-2-F3Y8J4`](../../../../specification/protocol-model/identity.md#req-id-2-f3y8j4)  | Covered               | **Here:** every key is checksummed on entry.                                                                                                                                                                                                                                                  | None.            |

## Component test obligations

Exact test evidence is mapped against these IDs in the verification test reports.

| Unit test ID                                                                            | Obligation     | Public entry and setup                                                        | Oracle and forbidden effects                                                     | Required permutations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| <a id="unit-test-blacklist-storage-1-c0xqyf"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF` | Verdict record | Record, re-record, read, remove, and clear verdicts by case-variant addresses | The first reason is kept; reads normalize; removal and clearing empty the record | <a id="unit-test-blacklist-storage-1-c0xqyf.p1"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P1` — record and read back the address and reason; <a id="unit-test-blacklist-storage-1-c0xqyf.p2"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P2` — a second verdict keeps the first reason and reports no new record; <a id="unit-test-blacklist-storage-1-c0xqyf.p3"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P3` — remove clears one entry and reports whether it existed; <a id="unit-test-blacklist-storage-1-c0xqyf.p4"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P4` — case-variant addresses read and remove the same entry; <a id="unit-test-blacklist-storage-1-c0xqyf.p5"></a>`UNIT-TEST-BLACKLIST-STORAGE-1-C0XQYF.P5` — clear empties every entry |

## Related source reports

- [Storage](./Storage.ts.md), [ProfileManager](../ProfileManager.ts.md), [P2PManager](../P2PManager.ts.md).
