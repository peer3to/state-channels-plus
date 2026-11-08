# packageIndexLazyModules.test.ts

Test file: [test/scripts/packageIndexLazyModules.test.ts](../../../../../../test/scripts/packageIndexLazyModules.test.ts)
Exercises: [EvmFactory.ts](../../../../implementation/source/src/evm/EvmFactory.ts.md), [axiosErrorUtils.ts](../../../../implementation/source/src/utils/logging/axiosErrorUtils.ts.md)

## Overview

The suite checks, in a fresh node process each, that loading the package index loads neither the
EVM package nor axios, and that creating an EVM does load the EVM package (the control). It also
checks that the uploader's own axios error check answers as axios's does.

## Tests

- `loads no EVM until an EVM is created`: UNIT-TEST-EVM-FACTORY-2-16ZPQX.P1, UNIT-TEST-EVM-FACTORY-2-16ZPQX.P2
- `loads no axios`: UNIT-TEST-AXIOS-ERROR-1-Y9R801.P1
- `recognizes an axios error exactly as axios does`: UNIT-TEST-AXIOS-ERROR-1-Y9R801.P2
