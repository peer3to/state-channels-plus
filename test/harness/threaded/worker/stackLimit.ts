// W2 - side-effect import. raise V8 stack-trace cap so worker rejections
// don't truncate the orchestrator-side stack we need for debugging.

Error.stackTraceLimit = 200;
