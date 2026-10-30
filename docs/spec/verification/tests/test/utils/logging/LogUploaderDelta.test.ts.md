# LogUploaderDelta.test.ts

Test file: [test/utils/logging/LogUploaderDelta.test.ts](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts)
Exercises: [LogUploader.ts](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md)

## Overview

The suite drives the real `LogUploader` through the uploader fixture against a real HTTP receiver
that can hold a response open or refuse. The oracles are the bodies the receiver captured, their
sequence ranges, and the outcomes returned: the first upload sends the whole store; a later one only
what was added; nothing new means no POST, and no jitter sleep either; a refused POST leaves the
watermark so its entries ride along with the next; the body names the thread, identity and range;
an upload requested while one is in flight resolves only after its own POST; and the realm's thread-end cancel ends an upload whose POST is held, one in its 1 s retry delay after a refused POST, or one still in a 5 s jitter wait, within half a second with no entries, no retry and, for the jitter case, no POST. The retry-delay case cancels once that uploader reads its network snapshot for the retry, which happens just before the delay starts. The second-copy case loads the uploader modules a second time, as a runtime extension built separately from the SDK does, logs through that copy's uploader, and ends the thread through the first copy: its settle must return only after the receiver holds the copy's POST, and its cancel must end the copy's next upload in its 300 ms jitter wait with no entries.

## Tests

- `an idle store resolves without paying the jitter`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P4
- `sends the whole store on the first upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P1
- `sends only entries added since the last upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P2
- `does not POST when there is nothing new`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P3, REQ-LOG-3-T9FM2K.T1.P2
- `ends an upload still running when its thread ends, without a retry or its queued follow-up`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P15
- `ends an upload in its jitter wait when its thread ends, before it posts`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P16
- `ends an upload in its retry delay when its thread ends, without the retry`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P17
- `lets an upload in its jitter wait post before its thread ends`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P18
- `an ending thread waits for an upload of a second copy of the uploader module in it, and cancels it`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P25, REQ-LOG-10-69CTN1.T1.P7
- `an ending thread waits for its running upload no longer than its bound`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P19
- `an ending thread waits no longer for an upload of an abort flush whose deadline passed`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P20
- `an ending thread waits again for a later upload once an abort flush's upload finished`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P21
- `an ending thread waits for an upload queued by an error behind an abort flush's upload whose deadline passed`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P22
- `an ending thread waits for an upload queued during a running abort flush only until that flush's deadline`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P23
- `an ending thread waits for a request during an abort flush queued behind an earlier upload only until that flush's deadline`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P24
- `re-sends the delta after a failed upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P5, REQ-LOG-5-ST6S0G.T1.P2
- `files an upload under the identity current after the jitter`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P13
- `sends threadName and the sequence range`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P6, REQ-LOG-4-W5XR7Q.T1.P1
- `a flush requested during an in-flight upload resolves after the second POST`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P7
- `finishes an awaited local upload after its last logger is disposed`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P14
