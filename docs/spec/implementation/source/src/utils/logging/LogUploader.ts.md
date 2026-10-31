# LogUploader.ts

> **Source:** [src/utils/logging/LogUploader.ts](../../../../../../../src/utils/logging/LogUploader.ts)

## Requirements

- [`REQ-LOG-1-H2VQ8X` (Logging cleanup preserves surviving owners)](../../../../../specification/runtime/log-collection.md#req-log-1-h2vq8x)
- [`REQ-LOG-2-N6BJ3D` (The caller receives its local upload outcome)](../../../../../specification/runtime/log-collection.md#req-log-2-n6bj3d)
- [`REQ-LOG-3-T9FM2K` (Writing a log line does not disturb the session)](../../../../../specification/runtime/log-collection.md#req-log-3-t9fm2k)
- [`REQ-LOG-4-W5XR7Q` (Every line says where it came from)](../../../../../specification/runtime/log-collection.md#req-log-4-w5xr7q)
- [`REQ-LOG-5-ST6S0G` (Sending twice does not store twice)](../../../../../specification/runtime/log-collection.md#req-log-5-st6s0g)
- [`REQ-LOG-6-Q8KY4N` (One run's logs never overwrite another's)](../../../../../specification/runtime/log-collection.md#req-log-6-q8ky4n)
- [`REQ-LOG-11-F5TJQC` (An aborting runtime uploads its logs before it disposes)](../../../../../specification/runtime/log-collection.md#req-log-11-f5tjqc)

## UNIT-TEST-LOG-UPLOADER-1-TBRV7K

Delta upload against a real receiver, and crash capture that never throws.

- Setup: Real uploader and store through the fixture; a real HTTP receiver that can hold or refuse.
- Oracle: What the receiver decoded, the sequence range on the body, and the outcome; no POST for nothing new; no throw from capture.

- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P1` — the first upload sends the whole store
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P2` — a later upload sends only what was added since
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P3` — nothing new sends no POST
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P4` — an idle store resolves without paying the jitter
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P5` — a failed POST leaves the watermark and its entries ride along next time
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P6` — the body carries the thread, the identity and the sequence range
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P7` — an upload requested mid-flight resolves after its own POST
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P8` — a routine entry uploads
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P9` — an error captured during the jitter sleep lands in that POST
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P10` — a captured error uploads without its secret fields
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P11` — a reason whose toString throws still uploads one safe record
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P12` — an error whose accessors throw still uploads
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P13` — an identity set during the jitter files that batch and re-sends nothing
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P14` — an awaited upload completes its retry after the last logger is disposed, without logging through the disposed logger
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P15` — ending its thread cancels an upload still posting at once, with no entries and no retry
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P16` — ending its thread cancels an upload in its jitter wait before it posts
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P17` — ending its thread cancels an upload in its retry delay at once, with no entries and no retry
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P18` — an ending thread first lets an upload in its jitter wait post its entries
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P25` — an ending thread waits for, then cancels, the upload of an uploader from a second copy of the module: the realm's set of busy uploaders is one per realm, on the global object
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P19` — an ending thread waits for a held upload only until its bound, then cancels it
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P20` — an ending thread cancels a running upload of an abort flush whose deadline passed without waiting
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P21` — an earlier abort flush's deadline does not cut the wait for a later upload
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P22` — an upload an error queued behind an abort flush's upload is waited for after that flush's deadline
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P23` — an upload queued during a running abort flush is waited for only until that flush's deadline
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P24` — a request during an abort flush that is queued behind an earlier upload keeps that flush's deadline
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P26` — a later flush's deadline also bounds an upload queued earlier without one
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P27` — a flush's upload sleeps its jitter at most half the time left to the flush's deadline, so a short flush still sends
- [x] `UNIT-TEST-LOG-UPLOADER-1-TBRV7K.P28` — a flush ends the jitter wait of an upload already running, so an error's upload started just before a disposal reaches the endpoint
