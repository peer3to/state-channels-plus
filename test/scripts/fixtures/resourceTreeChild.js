const { fork } = require("child_process");

if (process.argv[2] === "grandchild") {
    const memory = Buffer.alloc(64 * 1024 * 1024, 1);
    process.send?.({ rssKb: process.memoryUsage().rss / 1024 });
    setInterval(() => memory[0]++, 1000);
} else {
    const grandchild = fork(__filename, ["grandchild"], {
        stdio: ["ignore", "ignore", "ignore", "ipc"]
    });
    grandchild.once("message", (message) => {
        process.send?.({
            kind: "ready",
            parentRssKb: process.memoryUsage().rss / 1024,
            grandchildPid: grandchild.pid,
            grandchildRssKb: message.rssKb
        });
    });
    process.on("message", (message) => {
        if (message === "stop") {
            grandchild.kill("SIGKILL");
            process.exit(0);
        }
    });
    process.on("exit", () => grandchild.kill("SIGKILL"));
}
