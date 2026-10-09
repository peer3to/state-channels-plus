# AgreementManagerVerificationTiers.test.ts

Test file: [test/unit/AgreementManagerVerificationTiers.test.ts](../../../../../../test/unit/AgreementManagerVerificationTiers.test.ts)

## Overview

Verifies proofs from local final state, the local diamond and the canonical chain. Cases distinguish false verification results from thrown failures and check the selected trusted start.

## Tests

- `U26: the latest local finalized state verifies the proof → accepted there, the mirror and chain walks never run`: REQ-SP-9-RNXP56.T3.P1, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P37
- `U27: no local finalized state above the anchor → the mirror's walk accepts the proof, the chain walk never runs`: REQ-SP-9-RNXP56.T3.P2, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P38
- `U27: the local finalized walk returns false (a conflicting block at its height) → the mirror's walk accepts the proof`: REQ-SP-9-RNXP56.T3.P3, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P39
- `U28: the mirror holds no same-fork anchor (it walks from the genesis) and its walk fails → the chain's anchor walk accepts the proof`: REQ-SP-9-RNXP56.T3.P4, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P40
- `U28: the mirror's anchor walk returns false (it lacks a consumed inbound block) → the chain's walk accepts the proof`: REQ-SP-9-RNXP56.T3.P5, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P41
- `U29: a proof every tier rejects (an unlinked block after the anchor) → verification returns the chain's invalid walk`: REQ-SP-9-RNXP56.T3.P6, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P42
- `U30: the local finalized tier throws (storage lacks a required participant-change block) → verification throws, no later tier runs`: REQ-SP-9-RNXP56.T3.P7, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P43
- `U30: the mirror's walk fails on the local EVM connection → verification throws, the chain walk never runs`: REQ-SP-9-RNXP56.T3.P8, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P44
- `U30: the chain walk fails on the node RPC connection → verification throws instead of returning an invalid verdict`: REQ-SP-9-RNXP56.T3.P9, UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P45
- `RR1: a chain anchor advance during verification returns the checked start and skips malformed old history in persistence`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P60
- `RR1: a mirror anchor advance during verification returns the checked start and skips malformed old history in persistence`: UNIT-TEST-AGREEMENT-MANAGER-1-KJ6Q9D.P61
