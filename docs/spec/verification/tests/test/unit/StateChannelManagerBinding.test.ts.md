# test/unit/StateChannelManagerBinding.test.ts — Test Report

> **Test file:** [test/unit/StateChannelManagerBinding.test.ts](../../../../../../test/unit/StateChannelManagerBinding.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [stateChannelManager.ts](../../../../implementation/source/src/utils/stateChannelManager.ts.md), [contractAbi.ts](../../../../implementation/source/src/utils/contractAbi.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

Seven pure ABI cases prove the canonical manager binding keeps the interface's exact call/event
surface, the generated error union once, every prior proxy error, a facet-only argument error, and
both proxy/facet errors after the same JSON round trip used by the runtime port. The consumer merge
case proves consumer-only function, event, and error fragments survive while an SDK duplicate wins.
The final case checks null-runner address binding.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                  | Covers                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`stateChannelManager binding > keeps functions and events exactly equal to the manager interface`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L23) (line 23) | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P1`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p1), [`UNIT-TEST-CONTRACT-ABI-1-HW1A66.P1`](../../../../implementation/source/src/utils/contractAbi.ts.md#unit-test-contract-abi-1-hw1a66.p1) |
| [`stateChannelManager binding > includes the generated manager error union exactly once`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L36) (line 36)           | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P2`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p2), [`UNIT-TEST-CONTRACT-ABI-1-HW1A66.P2`](../../../../implementation/source/src/utils/contractAbi.ts.md#unit-test-contract-abi-1-hw1a66.p2) |
| [`stateChannelManager binding > parses every custom error exposed by the old proxy artifact`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L43) (line 43)       | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P3`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p3)                                                                                                                                           |
| [`stateChannelManager binding > parses a facet-only error with its arguments`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L59) (line 59)                      | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P4`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p4)                                                                                                                                           |
| [`stateChannelManager binding > round-trips the complete ABI through the runtime JSON payload`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L71) (line 71)     | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P5`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p5)                                                                                                                                           |
| [`stateChannelManager binding > merges consumer ABI extensions after the SDK manager ABI`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L93) (line 93)          | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P9`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p9)                                                                                                                                           |
| [`stateChannelManager binding > connects a read-only binding when no runner is given`](../../../../../../test/unit/StateChannelManagerBinding.test.ts#L126) (line 126)            | [`UNIT-TEST-MANAGER-BINDING-1-WB503Z.P6`](../../../../implementation/source/src/utils/stateChannelManager.ts.md#unit-test-manager-binding-1-wb503z.p6)                                                                                                                                           |
