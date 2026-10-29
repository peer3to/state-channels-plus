const { spawn } = require("child_process");

class IsolatedGuestCommandRunner {
    constructor(options = {}) {
        this.keepaliveIntervalMs = options.keepaliveIntervalMs || 30000;
    }

    run(command, args, options) {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                cwd: options.cwd,
                env: options.env,
                stdio: ["ignore", "pipe", "pipe"],
                detached: false
            });
            child.stdout.on("data", (data) => options.onOutput("stdout", data));
            child.stderr.on("data", (data) => options.onOutput("stderr", data));
            const description = [command, ...args].join(" ").slice(0, 256);
            const keepalive = setInterval(
                () => options.onStage?.(`Still running ${description}`),
                this.keepaliveIntervalMs
            );
            const finish = (callback) => {
                clearInterval(keepalive);
                callback();
            };
            child.once("error", (error) => finish(() => reject(error)));
            child.once("exit", (code, signal) => {
                if (code === 0) finish(resolve);
                else {
                    finish(() =>
                        reject(
                            new Error(
                                `${command} ${args.join(" ")} failed (${code ?? signal})`
                            )
                        )
                    );
                }
            });
        });
    }
}

module.exports = { IsolatedGuestCommandRunner };
