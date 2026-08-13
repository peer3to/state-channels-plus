# test/scripts/crashLogServer.test.ts — Test Report

> **Test file:** [test/scripts/crashLogServer.test.ts](../../../../../../../test/scripts/crashLogServer.test.ts) > **Status:** Skeleton — declarations inventoried mechanically; setup/oracle inspection pending.
> Declarations are listed by name and line (not exact links) until each is inspected and mapped;
> exact `[test](...#L<declaration>)` links are added only on inspected traceability rows.

## Declaration inventory

Classification levels: Unit / Integration / System / End-to-end (per declaration, not per file).

| Test declaration                                                                                                  | Level        | Production entry point | Specification permutations | Implementation obligations | Evidence quality   |
| ----------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------- | -------------------------- | -------------------------- | ------------------ |
| `crash-log-server sanitizeSegment - path traversal > leaves legitimate hex ids / addresses unchanged` (line 20)   | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `crash-log-server sanitizeSegment - path traversal > replaces every disallowed character with _` (line 27)        | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |
| `crash-log-server sanitizeSegment - path traversal > keeps a sanitized segment contained under LOG_DIR` (line 31) | Unclassified | _pending_              | none — gap                 | none — gap                 | Pending inspection |

## Environment and support code

_Pending: runtime/environment notes and any support code that materially affects setup or oracle._

## Remaining gaps

_Pending inspection._
