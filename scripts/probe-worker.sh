#!/usr/bin/env bash
# step 1 - probe a single test in both modes. usage: ./probe-worker.sh <file> "<grep>"
set -u
FILE="$1"
GREP="$2"
mkdir -p ./logs

# step 1 - single-thread baseline
timeout 90 env LOG_LEVEL=warn yarn hardhat test "$FILE" --grep "$GREP" > ./logs/baseline.log 2>&1
ST_CODE=$?
ST_STATUS=$(grep -Eo "[0-9]+ (passing|failing|pending)" ./logs/baseline.log | tr '\n' ' ')
echo "[baseline] code=$ST_CODE -> $ST_STATUS"

if [ $ST_CODE -ne 0 ]; then
    echo "[baseline] FAIL -> skipping worker probe"
    tail -20 ./logs/baseline.log
    exit 1
fi

# step 2 - worker-mode probe
timeout 120 env LOG_LEVEL=warn HARNESS_DEDICATED_PEER_THREAD=true yarn hardhat test "$FILE" --grep "$GREP" > ./logs/worker.log 2>&1
WK_CODE=$?
WK_STATUS=$(grep -Eo "[0-9]+ (passing|failing|pending)" ./logs/worker.log | tr '\n' ' ')
echo "[worker]   code=$WK_CODE -> $WK_STATUS"

if [ $WK_CODE -ne 0 ]; then
    echo "[worker] FAIL excerpt:"
    grep -E "(Error|TypeError|at .*\.ts)" ./logs/worker.log | head -30
fi
exit $WK_CODE
