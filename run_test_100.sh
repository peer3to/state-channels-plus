#!/bin/bash

# Configuration
TEST_COMMAND='yarn test:e2e:verbose'
TOTAL_RUNS=20
LOG_DIR="/tmp/test-failures-$(date +%Y%m%d-%H%M%S)"
SUMMARY_FILE="/tmp/test-summary-full-e2e-suite-$(date +%Y%m%d-%H%M%S).txt"

# Create log directory
mkdir -p "$LOG_DIR"

# Initialize counters
FAILURES=0
SUCCESSES=0

echo "Starting $TOTAL_RUNS test runs..."
echo "Failed test logs will be saved to: $LOG_DIR"
echo ""

# Run tests
for i in $(seq 1 $TOTAL_RUNS); do
    echo -n "Run $i/$TOTAL_RUNS: "
    
    # Run test and capture output
    OUTPUT=$(eval "$TEST_COMMAND" 2>&1)
    EXIT_CODE=$?
    
    if [ $EXIT_CODE -eq 0 ]; then
        echo "PASSED"
        ((SUCCESSES++))
    else
        echo "FAILED"
        ((FAILURES++))
        # Save log only on failure
        echo "$OUTPUT" > "$LOG_DIR/failure-run-$i.log"
    fi
done

# Generate summary
SUMMARY="Test Run Summary
==================
Total Runs: $TOTAL_RUNS
Passed: $SUCCESSES
Failed: $FAILURES
Success Rate: $(awk "BEGIN {printf \"%.2f\", ($SUCCESSES/$TOTAL_RUNS)*100}")%
Failure Rate: $(awk "BEGIN {printf \"%.2f\", ($FAILURES/$TOTAL_RUNS)*100}")%

Failed test logs saved to: $LOG_DIR
"

# Print to console
echo ""
echo "$SUMMARY"

# Save to file
echo "$SUMMARY" > "$SUMMARY_FILE"
echo "Summary saved to: $SUMMARY_FILE"