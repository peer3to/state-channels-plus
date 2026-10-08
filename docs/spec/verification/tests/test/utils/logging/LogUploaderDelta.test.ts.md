# LogUploaderDelta.test.ts

Test file: [test/utils/logging/LogUploaderDelta.test.ts](../../../../../../../test/utils/logging/LogUploaderDelta.test.ts)
Exercises: [LogUploader.ts](../../../../../implementation/source/src/utils/logging/LogUploader.ts.md)

## Overview

The suite drives the real `LogUploader` through the uploader fixture against a real HTTP receiver
that can hold a response open or refuse. The oracles are the bodies the receiver captured, their
sequence ranges, and the outcomes returned: the first upload sends the whole store; a later one only
what was added; nothing new means no POST, and no jitter sleep either; a refused POST leaves the
watermark so its entries ride along with the next; the body names the thread, identity and range;
and an upload requested while one is in flight resolves only after its own POST.

## Tests

- `an idle store resolves without paying the jitter`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P4
- `sends the whole store on the first upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P1
- `sends only entries added since the last upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P2
- `does not POST when there is nothing new`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P3, REQ-LOG-3-T9FM2K.T1.P2
- `re-sends the delta after a failed upload`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P5, REQ-LOG-5-ST6S0G.T1.P2
- `files an upload under the identity current after the jitter`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P13
- `sends threadName and the sequence range`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P6, REQ-LOG-4-W5XR7Q.T1.P1
- `a flush requested during an in-flight upload resolves after the second POST`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P7
- `finishes an awaited local upload after its last logger is disposed`: UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P14
