# AgreementManagerBuildFallback.test.ts — Test report

> **Test file:** [test/unit/AgreementManagerBuildFallback.test.ts](../../../../../../test/unit/AgreementManagerBuildFallback.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Exercises proof construction when local evidence cannot advance the finalized target and checks the returned fallback proof through the public manager boundary.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                                                                                                  | Covers                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Unit: AgreementManager buildStateProof walk fallback > the mirror's walk of the built proof is invalid (it lacks a consumed inbound block) → the chain's walk accepts, the proof is returned`](../../../../../../test/unit/AgreementManagerBuildFallback.test.ts#L13) (line 13) | [`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P56`](../../../../implementation/source/src/agreementManager/AgreementManager.ts.md#unit-test-agreement-manager-1-kj6q9d.p56) |
| [`Unit: AgreementManager buildStateProof walk fallback > the mirror and the chain both reject the built proof (both lack the consumed inbound block) → buildStateProof throws, no proof`](../../../../../../test/unit/AgreementManagerBuildFallback.test.ts#L39) (line 39)        | [`UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P57`](../../../../implementation/source/src/agreementManager/AgreementManager.ts.md#unit-test-agreement-manager-1-kj6q9d.p57) |
