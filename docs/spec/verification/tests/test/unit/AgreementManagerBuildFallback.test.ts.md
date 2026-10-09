# AgreementManagerBuildFallback.test.ts

Test file: [test/unit/AgreementManagerBuildFallback.test.ts](../../../../../../test/unit/AgreementManagerBuildFallback.test.ts)

## Overview

Exercises proof construction when local evidence cannot advance the finalized target and checks the returned fallback proof through the public manager boundary.

## Tests

- `the mirror's walk of the built proof is invalid (it lacks a consumed inbound block) → the chain's walk accepts, the proof is returned`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P56
- `the mirror and the chain both reject the built proof (both lack the consumed inbound block) → buildStateProof throws, no proof`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P57
