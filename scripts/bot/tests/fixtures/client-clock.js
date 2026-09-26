const fs = require("node:fs/promises");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

// Control only the client's deadline timers; discovery and authenticated transport
// retain their real clocks. The production client source is executed unchanged.
async function clientClock() {
    let now = 0;
    const timers = new Map();
    const filename = path.resolve(__dirname, "../../client.js");
    const module = { exports: {} };
    const source = await fs.readFile(filename, "utf8");
    vm.runInThisContext(
        `(function(require,module,setTimeout,clearTimeout){${source}\n})`,
        { filename }
    )(
        createRequire(filename),
        module,
        (callback, delay) => {
            const token = {};
            timers.set(token, { at: now + delay, callback });
            return token;
        },
        (token) => timers.delete(token)
    );
    return {
        callService: module.exports.callService,
        advance(ms) {
            now += ms;
            for (const [token, timer] of timers) {
                if (timer.at <= now) {
                    timers.delete(token);
                    timer.callback();
                }
            }
        }
    };
}
module.exports = { clientClock };
