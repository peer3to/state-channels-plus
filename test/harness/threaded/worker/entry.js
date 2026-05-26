// W2 §8 - ts-node shim. workers are fresh node isolates so ts-node/register
// has to run per-worker. tsconfig-paths is registered by ts-node config for
// @/ + @test/ + @typechain-types/ alias resolution.
"use strict";
require("ts-node/register");
require("tsconfig-paths/register");
require("./entry.ts");
