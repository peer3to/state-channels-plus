# Review: implementation of plan 3 — host-owned chain signer

state-channels-plus · general-test-fixes-2 · reviews [`3-implementation.md`](./3-implementation.md)

**Bottom line:** rework before landing. Both typechecks and focused tests pass, but one 🔴 concurrency defect remains. One finding needs a human decision (OO1).

**Human assessment needed**

- [OO1](#-open-questions) 75% — keep secret-only identity as a public SDK constraint, or restore an external-signer bridge?

## 📐 Plan Adherence

- 🟢 **[HG1] 95% — Every planned production, test, documentation, and verification item is implemented or explicitly accounted for by the plan's scope.**

    > **Fix HG1-FIX**
    >
    > No change required.

## ⚖️ Contradictions

- 🟢 **[XG1] 95% — The specification, implementation report, verification reports, and actual source and tests agree for the reviewed scope.**

    > **Fix XG1-FIX**
    >
    > No change required.

## 🧱 Fundamental

- 🔴 **[FR1] 95% — `HostNonceManager` resets shared nonce state while sends remain in flight.** [`reset()`](../../../src/evm/signer/HostNonceManager.ts#L23) forgets reservations owned by concurrent sends.

    > **Fix FR1-FIX**
    >
    > Serialize nonce reservation through successful submission in `HostNonceManager`; prove it with a concurrent middle-failure test whose surviving and subsequent sends have unique consecutive nonces.

## 🔒 Security (trust boundary)

- 🟡 **[SY1] 70% — Relayed error metadata is classification data, not authenticated identity.** Remote fields must not drive security decisions alone.

    > **Fix SY1-FIX**
    >
    > Require security-sensitive branches to validate local state and ABI revert data; add a test showing forged relayed `code`/`reason` fields cannot trigger the branch.

## 🏁 Race conditions

- 🔴 **[RR1] 90% — A failed middle reservation can collide with a later send.** See FR1.

    > **Fix RR1-FIX**
    >
    > Implement FR1-FIX, then deterministically pause three sends, fail the middle reservation, and assert the remaining nonce sequence.

## ⚡ Performance

- 🟡 **[PY1] 85% — `getAddress` takes an unnecessary port round-trip.** The client already knows the immutable address.

    > **Fix PY1-FIX**
    >
    > Store the known signer address on `ClientChainSigner` and return it from `getAddress`; verify no `chainSignerGetAddress` request crosses the port.

## 🧪 Tests (regressions / gaps)

- 🔴 **[TR1] 95% — The concurrency test omits failure while other sends are in flight.** It cannot catch FR1.

    > **Fix TR1-FIX**
    >
    > Add the missing test to `HostNonceManager.test.ts`: fail the middle of three outstanding sends, then assert survivors and the next send use unique consecutive nonces.

## ♻️ Code reuse

- 🟠 **[CO1] 90% — [`serializeTransaction`](../../../src/evm/signer/ClientChainSigner.ts#L88) reimplements [`Codec.encode(tx, Type.Transaction)`](../../../src/utils/Codec.ts#L214).** Two encoders for one wire shape will drift on the next field.

    > **Fix CO1-FIX**
    >
    > Delete the local helper and call `Codec.encode`; acceptance: grep `serializeTransaction` returns only the Codec site, existing port tests stay green.

- 🟠 **[CO2] 95% — The "moved" nonce math forked the original — both copies are alive.** [`nextNonce`](../../../src/evm/signer/HostNonceManager.ts#L52) was copied from [`ManagedNonceSigner`](../../../src/evm/signer/ManagedNonceSigner.ts#L67), which still compiles and is still exported.

    > **Fix CO2-FIX**
    >
    > Finish the move: delete the `ManagedNonceSigner` copy, point its call sites at `HostNonceManager`, and grep for the old symbol to confirm one source remains.

## 🧼 Dead Code/Cleanup

- 🟠 **[KO1] 85% — The old `ManagedNonceSigner` class has no supported caller after the host migration.** Its export and tests keep an obsolete path alive.

    > **Fix KO1-FIX**
    >
    > Delete the class, export, and obsolete fixture after migrating the remaining caller; acceptance: symbol and import greps return no live sites and the signer suites stay green.

## 📏 AGENTS.md adherence

- 🟠 **[AO1] 100% — [`HostNonceManager`](../../../src/evm/signer/HostNonceManager.ts#L8) interleaves a field between methods.** AGENTS.md requires `{fields, then methods}` — never interleave.

    > **Fix AO1-FIX**
    >
    > Hoist `reservedNonces` to the top field block with the other fields; re-read the class top-to-bottom to confirm no field sits below a method.

- 🟡 **[AY2] 100% — [`getAddress`](../../../src/evm/signer/ClientChainSigner.ts#L41) casts via `Awaited<ReturnType<typeof ...>>` instead of the named type.** AGENTS.md bans `ReturnType` wrappers.

    > **Fix AY2-FIX**
    >
    > Import and annotate with the exported `ChainSignerAddress` type; drop the wrapper.

## 📚 Doc

- 🟢 **[DG1] 90% — The changed documentation follows the applicable docs rules and covers every changed behavior and test mapping.**

    > **Fix DG1-FIX**
    >
    > No change required.

## 🧹 Miscellaneous (scope)

- 🟠 **[MO1] 80% — The public setup surface silently creates an unfunded identity.** This can hide missing configuration.

    > **Fix MO1-FIX**
    >
    > Make generated identity an explicit setup option; otherwise reject a missing secret before starting the runtime and test both paths.

## ❓ Open questions

- 🟠 **[OO1] 75% — Is secret-only identity an intentional public SDK constraint?** **Human assessment needed** Decision: keep secret-only identity as a public SDK constraint, or restore an external-signer bridge. This decides whether injected signers remain supported.

    > **Fix OO1-FIX**
    >
    > Decide whether injected signers are supported. If yes, restore an external-signer bridge; if no, document secret-only ownership as a public API constraint.
