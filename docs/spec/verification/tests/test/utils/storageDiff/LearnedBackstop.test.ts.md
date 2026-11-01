# LearnedBackstop.test.ts

Test file: [test/utils/storageDiff/LearnedBackstop.test.ts](../../../../../../../test/utils/storageDiff/LearnedBackstop.test.ts)
Exercises: [LearnedBackstop.ts](../../../../../implementation/source/src/utils/storageDiff/LearnedBackstop.ts.md)

## Overview

Cases build a `LearnedBackstop` with a clock the test moves by hand, record arrival durations and read the bound it gives: the cap with no arrival, a multiple of the slowest arrival, the cap as a ceiling, a cap that moves, and the window that forgets old arrivals. `capLeavingNodeRoundTrips` is read for the deadline less a multiple of the slowest recent node round trip, the whole deadline before any, zero as the floor, and the window.

## Tests

- `is the cap before any arrival was observed`: REQ-SDS-12-N40MKR.T1.P5
- `is a multiple of the slowest recent arrival once arrivals were observed`: REQ-SDS-12-N40MKR.T1.P7
- `never exceeds the cap, however slow an arrival was`: REQ-SDS-12-N40MKR.T1.P7
- `forgets arrivals older than the window, and is the cap again once all are forgotten`: REQ-SDS-12-N40MKR.T1.P8
- `follows a cap that moves, and never exceeds it`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `is the whole deadline until a node round trip was observed`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `is the deadline less a multiple of the slowest recent node round trip`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `shrinks as node round trips grow, and is never below zero`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `is the whole deadline again once the round trips are older than the window`: REQ-RPCMIRROR-4-H35NFC.T1.P15
- `forgets announcements older than the window when another block is announced`: REQ-RPCMIRROR-4-H35NFC.T1.P17
- `keeps announcements inside the window`: REQ-RPCMIRROR-4-H35NFC.T1.P17
- `forgets every announcement on clear`: REQ-RPCMIRROR-4-H35NFC.T1.P17
- `hands over how long each announced block up to the arrived one took, and keeps later ones`: REQ-RPCMIRROR-4-H35NFC.T1.P17
- `does not hand over an announcement older than the window`: REQ-RPCMIRROR-4-H35NFC.T1.P17
