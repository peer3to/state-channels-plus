# Review: host-owned chain signer

**Bottom line:** rework. One concurrency defect and one unresolved API decision need attention. This is a source-only review; no tests were run by the reviewer.

## 🧱 Fundamental

- 🔴 **[FR1] — Resetting shared reservations can assign the same nonce to concurrent sends.**

    **Problem and evidence.** In [reset()](../../../src/evm/signer/HostNonceManager.ts#L23), the failure path clears reservations while other sends can still own them. Consider three sends that reserve consecutive nonces. If the middle send fails and reset clears the whole set, the next send can reserve a nonce that the third send is still preparing to submit.

    **Impact.** The two submissions now compete for the same account nonce. One can replace or invalidate the other, so a caller that did not fail loses its transaction. Retrying only the failed caller does not repair the lost ownership of the surviving reservation.

    > **Fix FR1-FIX**
    >
    > Keep reservation ownership per send and release only the failed send's reservation. Serialize allocation and submission-state updates in HostNonceManager so reset cannot forget another send's live reservation. Do not solve this by clearing all reservations on each error.
    >
    > **Verification:** add a deterministic test that pauses three sends after allocation, fails the middle one, then starts a fourth. Verify the surviving sends and the fourth never own the same nonce and that failure recovery does not leave a permanent gap. This is a proposed test, not one executed during this review.

## ❓ Open questions

- 🟠 **[OO1] — The public signer contract needs an explicit compatibility decision.** 🙋 **Human assessment needed**

    **Decision:** must the public client keep supporting external signers, or is a secret-backed signer now an intentional requirement?

    **Evidence and impact.** The host-owned flow assumes it can sign locally. Existing external-signer callers cannot meet that assumption without moving their keys into the host, which changes their custody boundary. Source alone does not establish whether breaking those callers is intended.

    > **Fix OO1-FIX**
    >
    > Prefer retaining an external-signer bridge if existing integrators are still supported: let the external signer authorize the transaction while keeping nonce ownership in the host. If the engineer instead chooses a secret-only contract, document the breaking change and migration requirement explicitly. Do not silently substitute local key custody.
    >
    > **Verification after the decision:** exercise the selected public API with both supported signer types, or prove that unsupported external signers fail with a clear migration error. Wait for the human decision before implementing either branch.
