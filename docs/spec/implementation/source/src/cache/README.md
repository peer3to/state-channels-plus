# src/cache — Subsystem

> **Status:** Authored — engineer verification pending.

Per-thread memos of signature recovery. Both are local derived data: never stored, never sent,
bounded by `SIGNER_RECOVERY_CACHE_MAX` with oldest-first eviction, and a hit never changes a
result. They differ in who decides validity:

- [SignerRecoveryCache](./SignerRecoveryCache.ts.md) is a client-side check. It decides which
  signature encodings are valid, under the contracts' exact acceptance rule (the signature
  carve-out of [`INV-MIRROR-1-VAF778` (Single implementation)](../../../../specification/enforcement/local-mirror.md#inv-mirror-1-vaf778)), and recovers the signer for every protocol
  signature the TypeScript code checks.
- [EcrecoverCache](./EcrecoverCache.ts.md) decides nothing. It memoizes the local EVM's
  `ecrecover` precompile below the contract code, so mirror calls keep the contracts' own verdicts.

## Contents

- [EcrecoverCache.ts](./EcrecoverCache.ts.md)
- [SignerRecoveryCache.ts](./SignerRecoveryCache.ts.md)
- [index.ts](./index.ts.md)

## Source inventory

| Source | Report |
| --- | --- |
| [EcrecoverCache.ts](../../../../../../src/cache/EcrecoverCache.ts) | [EcrecoverCache.ts.md](./EcrecoverCache.ts.md) |
| [SignerRecoveryCache.ts](../../../../../../src/cache/SignerRecoveryCache.ts) | [SignerRecoveryCache.ts.md](./SignerRecoveryCache.ts.md) |
| [index.ts](../../../../../../src/cache/index.ts) | [index.ts.md](./index.ts.md) |

## Shared design

- **Two memos, one bound.** Both read `SIGNER_RECOVERY_CACHE_MAX` from
  [config](../utils/config.ts.md); each keeps its own map, so the bound applies to each separately.
- **Same signatures, two paths.** A block confirmation signature is recovered by
  SignerRecoveryCache when the client classifies it at intake, and again by the ecrecover
  precompile when a mirrored contract check reads it. The two paths agree because the client rule
  accepts exactly what the contracts accept; the parity test of SignerRecoveryCache is the guard.

## Integration obligations

None beyond the file-level obligations: the two modules do not call each other.
