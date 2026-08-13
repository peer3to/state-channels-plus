# test/unit/DeploymentCache.test.ts — Test Report

> **Test file:** [test/unit/DeploymentCache.test.ts](../../../../../../../test/unit/DeploymentCache.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                             | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `resolveOrDeployShared (component) > deploys once and serves every later caller from the marker` (line 16)                   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `resolveOrDeployShared (component) > gives concurrent first callers a usable value each, then caches for the rest` (line 41) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `resolveOrDeployShared (component) > redeploys when the stored value no longer validates` (line 76)                          | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `resolveOrDeployShared (component) > deploys directly when no cache dir is configured` (line 101)                            | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
