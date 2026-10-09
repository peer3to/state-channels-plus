# StateChannelManagerBinding.test.ts

Test file: [test/unit/StateChannelManagerBinding.test.ts](../../../../../../test/unit/StateChannelManagerBinding.test.ts)
Exercises: [stateChannelManager.ts](../../../../implementation/source/src/utils/stateChannelManager.ts.md), [contractAbi.ts](../../../../implementation/source/src/utils/contractAbi.ts.md)

## Overview

Seven pure ABI cases prove the canonical manager binding keeps the interface's exact call/event
surface, the generated error union once, every prior proxy error, a facet-only argument error, and
both proxy/facet errors after the same JSON round trip used by the runtime port. The consumer merge
case proves consumer-only function, event, and error fragments survive while an SDK duplicate wins.
The final case checks null-runner address binding.

## Tests

- `keeps functions and events exactly equal to the manager interface`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P1, UNIT-TEST-CONTRACT-ABI-1-HW1A66.P1
- `includes the generated manager error union exactly once`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P2, UNIT-TEST-CONTRACT-ABI-1-HW1A66.P2
- `parses every custom error exposed by the old proxy artifact`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P3
- `parses a facet-only error with its arguments`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P4
- `round-trips the complete ABI through the runtime JSON payload`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P5
- `merges consumer ABI extensions after the SDK manager ABI`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P9
- `connects a read-only binding when no runner is given`: UNIT-TEST-MANAGER-BINDING-1-WB503Z.P6
