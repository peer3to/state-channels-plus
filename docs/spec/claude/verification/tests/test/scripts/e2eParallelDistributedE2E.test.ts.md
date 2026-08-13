# test/scripts/e2eParallelDistributedE2E.test.ts — Test Report

> **Test file:** [test/scripts/e2eParallelDistributedE2E.test.ts](../../../../../../../test/scripts/e2eParallelDistributedE2E.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                        | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `distributed parallel runner > records the discovery server lifecycle before closing its log` (line 48)                 | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > yields a failed outgoing dial so the peer can reverse the connection` (line 96)          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > authenticates when the worker establishes the transport connection` (line 195)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > keeps discovering and connects to worker servers that appear later` (line 255)           | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > cancels while discovering before any worker connects` (line 317)                         | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > kills infrastructure grandchildren after a test process exits` (line 348)                | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > retains the test process termination signal` (line 391)                                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > rejects a wrong-secret client before it can request a lease` (line 408)                  | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > rejects source paths not present in the offered manifest` (line 440)                     | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > contains a preparation failure after the orchestrator disconnects` (line 505)            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `distributed parallel runner > moves an authenticated attempt log over a real socket and releases the lease` (line 549) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
