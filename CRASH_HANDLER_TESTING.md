# Quick Crash Handler Testing

This guide helps you test the crash handler quickly without rebuilding everything.

## Quick Start

### 1. Start the crash log server

```bash
node scripts/crash-log-server.js
```

### 2. Option A: Browser Test (Fastest - No SDK rebuild needed)

```bash
# Serve the test page
npx http-server . -p 8080 -c-1

# Open in browser
# http://localhost:8080/test-crash-handler.html
```

The test page lets you:

- Test `logger.error()` and child logger errors
- Test with BigInt values
- Test window errors and unhandled rejections
- See memory logs in real-time
- Verify crash uploads without rebuilding

### 3. Option B: Node Test (Fast - Tests without browser)

```bash
# Build SDK once
npm run build

# Run the test
node scripts/test-crash-handler.js
```

This tests the crash handler in Node.js with mocked browser APIs.

## Development Workflow

### Fast iteration (no SDK rebuild):

1. Edit `src/utils/logging/CrashHandler.ts`
2. Run `npm run build` (or `tsc && tsc-alias`)
3. Refresh `test-crash-handler.html` in browser
4. Click test buttons

### Even faster (direct browser testing):

1. Edit the inline code in `test-crash-handler.html`
2. Refresh browser
3. Test immediately

## What Each Test Does

- **Test logger.error()**: Tests main logger error logging and crash handler trigger
- **Test child logger.error()**: Verifies child loggers also trigger crash handler
- **Test Multiple Logs**: Adds multiple log entries then triggers error
- **Test with BigInt**: Verifies BigInt serialization works
- **Test Throw Error**: Tests window.onerror event handler
- **Test Unhandled Rejection**: Tests Promise rejection handler

## Checking Results

### Server logs:

Watch the crash log server terminal for:

- `[CrashLogServer] Request received`
- `[CrashLogServer] ✅ Saved crash log`

### Browser console:

Look for:

- `[CrashHandler] logger.error intercepted`
- `[CrashHandler] Triggering handleCrashEvent`
- `[CrashHandler] handleCrashEvent: Starting upload`
- `[CrashHandler] sendLogsToServer: Success!`

### Saved files:

```bash
ls -lah crash-logs/
```

### View crash log contents:

```bash
# If compressed
zcat crash-logs/test-crash-*.ndjson.gz | jq

# If uncompressed
cat crash-logs/test-crash-*.ndjson | jq
```

## Troubleshooting

### No logs collected:

- Check console for `[CrashHandler] Memory transport not found`
- Verify `enableMemoryStorage` is true

### No upload happening:

- Check console for `[CrashHandler] logger.error intercepted`
- Verify server is running on correct port
- Check browser Network tab for failed requests

### CORS errors:

- Verify server has correct CORS headers
- Check server logs for OPTIONS request
