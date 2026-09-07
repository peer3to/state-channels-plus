# Test harness

The shared leave watchdog is 60 seconds. Only tests whose subject is watchdog behavior override it. The production default remains 15 seconds.

The snapshot-update suite keeps its shared 6-second evidence window by owner decision. Leave-phase waits poll the existing state query because a phase change has no dedicated event. Monitor tests inject a real logger from the test tree; production exposes no test-only logger or Clock options.
