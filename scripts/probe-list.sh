#!/usr/bin/env bash
# step 1 - given test file + grep, print baseline-pass/fail then worker-pass/fail.
# silent except for one summary line so it's fast to iterate over.
set -u
FILE="$1"
GREP="$2"
mkdir -p ./logs

timeout 90 env LOG_LEVEL=warn yarn hardhat test "$FILE" --grep "$GREP" > /tmp/probe.log 2>&1
ST_CODE=$?
ST=$(grep -Eo "[0-9]+ passing" /tmp/probe.log | head -1)
if [ $ST_CODE -ne 0 ]; then
  echo "[$FILE :: $GREP] baseline-fail"
  exit 0
fi

timeout 120 env LOG_LEVEL=warn HARNESS_DEDICATED_PEER_THREAD=true yarn hardhat test "$FILE" --grep "$GREP" > /tmp/probe.log 2>&1
WK_CODE=$?
WK=$(grep -Eo "[0-9]+ passing" /tmp/probe.log | head -1)
if [ $WK_CODE -ne 0 ]; then
  REASON=$(grep -Eo "TypeError: Cannot read properties of undefined \(reading '[a-zA-Z]+'\)|EventBarrier timeout|W5BlockedError|WorkerSpyUnsupportedError|RejectClosure|reject.*lambda" /tmp/probe.log | head -1)
  echo "[$FILE :: $GREP] worker-blocked: $REASON"
else
  echo "[$FILE :: $GREP] worker-pass"
fi
