# MathStateMachine.test.ts

Test file: [test/unit/MathStateMachine.test.ts](../../../../../../test/unit/MathStateMachine.test.ts)
Exercises: [MathStateMachine.sol](../../../../implementation/source/contracts/V1/examples/MathStateMachine/MathStateMachine.sol.md)

## Overview

The reference math transition runs through real local execution and SDK authoring. Tests check exact roster order, per-member balances, total value, message anchors, turn progression, invalid inputs, and configured capacity. No node-wide test-chain mutations are used.

## Tests

- `the SDK rejects an insertion by the wrong author without changing roster state or eligibility`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P1
- `transfers part of the author's balance without changing total value or message anchors`: REQ-SM-11-VVP01C.T1.P1, UNIT-TEST-MATH-INSERTION-1-29TPFK.P2
- `accepts zero transfer from a funded author`: REQ-SM-11-VVP01C.T1.P2, UNIT-TEST-MATH-INSERTION-1-29TPFK.P3
- `accepts zero transfer from a zero-balance author`: REQ-SM-11-VVP01C.T1.P3, UNIT-TEST-MATH-INSERTION-1-29TPFK.P4
- `rejects insufficient balance without changing the state`: REQ-SM-11-VVP01C.T1.P4, UNIT-TEST-MATH-INSERTION-1-29TPFK.P5
- `rejects an existing target without changing the state`: REQ-SM-11-VVP01C.T1.P5, UNIT-TEST-MATH-INSERTION-1-29TPFK.P6
- `rejects self insertion without changing the state`: REQ-SM-11-VVP01C.T1.P6, UNIT-TEST-MATH-INSERTION-1-29TPFK.P7
- `rejects the zero address without changing the state`: REQ-SM-11-VVP01C.T1.P7, UNIT-TEST-MATH-INSERTION-1-29TPFK.P8
- `rejects a participant acting out of turn`: REQ-SM-11-VVP01C.T1.P8, UNIT-TEST-MATH-INSERTION-1-29TPFK.P9
- `rejects a nonparticipant author`: REQ-SM-11-VVP01C.T1.P9, UNIT-TEST-MATH-INSERTION-1-29TPFK.P10
- `selects the next author using the new roster after a wrapped turn index`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P11
- `fills the configured N minus one roster to exactly N`: REQ-SM-11-VVP01C.T1.P10, UNIT-TEST-MATH-INSERTION-1-29TPFK.P12
- `at capacity advances only the turn counter for a valid positive transfer`: REQ-SM-11-VVP01C.T1.P11, UNIT-TEST-MATH-INSERTION-1-29TPFK.P13
- `repeated full-capacity requests each advance exactly one turn`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P14
- `a zero-amount request at capacity cannot append a participant`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P15
- `an already oversized adopted roster remains unchanged`: REQ-SM-11-VVP01C.T1.P12, UNIT-TEST-MATH-INSERTION-1-29TPFK.P16
- `maximum one accepts a valid no-op and keeps its only author`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P17
- `capacity does not waive invalid-target checks`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P18
- `can transfer the author's exact remaining balance`: REQ-SM-11-VVP01C.T1.P13, UNIT-TEST-MATH-INSERTION-1-29TPFK.P19
- `capacity does not waive zero-address rejection`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P20
- `capacity does not waive duplicate-participant rejection`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P21
- `capacity does not waive insufficient balance`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P22
- `capacity does not waive turn authorization`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P23
- `capacity does not admit a nonparticipant author`: UNIT-TEST-MATH-INSERTION-1-29TPFK.P24
