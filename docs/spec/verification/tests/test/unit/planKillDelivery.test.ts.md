# planKillDelivery.test.ts

Test file: [test/unit/planKillDelivery.test.ts](../../../../../../test/unit/planKillDelivery.test.ts)
Exercises: [planKillDelivery.ts](../../../../implementation/source/src/disputeManager/planKillDelivery.ts.md)

## Overview

Calls `planKillDelivery` with kill and multicall sizes on both sides of the 65,536-byte transaction limit. Checks the kill rides in the upload's multicall when both fit, goes alone first when only the kill fits, and is not sent when it alone does not fit.

## Tests

- `kill and upload fit one transaction -> the kill goes first in the upload's multicall`: UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P1
- `the multicall is exactly at the limit -> it still goes as one multicall`: UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P2
- `the multicall is one byte over the limit -> the kill goes alone ahead of the upload`: UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P3
- `the kill alone is exactly at the limit -> it goes alone`: UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P4
- `the kill alone is one byte over the limit -> it is not sent, the upload still goes`: UNIT-TEST-PLAN-KILL-DELIVERY-1-CRTBS6.P5
