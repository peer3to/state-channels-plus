# LearnedBackstop.test.ts

Test file: [test/utils/storageDiff/LearnedBackstop.test.ts](../../../../../../../test/utils/storageDiff/LearnedBackstop.test.ts)
Exercises: [LearnedBackstop.ts](../../../../../implementation/source/src/utils/storageDiff/LearnedBackstop.ts.md)

## Overview

Cases build a `LearnedBackstop` with a clock the test moves by hand, record arrival durations and read the bound it gives: the cap with no arrival, a multiple of the slowest arrival, the cap as a ceiling, and the window that forgets old arrivals.

## Tests

- `is the cap before any arrival was observed`: REQ-SDS-12-N40MKR.T1.P5
- `is a multiple of the slowest recent arrival once arrivals were observed`: REQ-SDS-12-N40MKR.T1.P7
- `never exceeds the cap, however slow an arrival was`: REQ-SDS-12-N40MKR.T1.P7
- `forgets arrivals older than the window, and is the cap again once all are forgotten`: REQ-SDS-12-N40MKR.T1.P8
