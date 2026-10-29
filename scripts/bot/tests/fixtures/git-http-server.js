const http = require("node:http");
const { spawn } = require("node:child_process");
let hold = process.argv[3] === "hold";
const server = http.createServer(async (request, response) => {
    if (hold) {
        hold = false;
        await new Promise((resolve) => {
            process.once("message", resolve);
            process.send("fetch-held");
        });
    }
    const url = new URL(request.url, "http://127.0.0.1");
    const child = spawn("git", ["http-backend"], {
        env: {
            PATH: process.env.PATH,
            GIT_PROJECT_ROOT: process.argv[2],
            GIT_HTTP_EXPORT_ALL: "1",
            REQUEST_METHOD: request.method,
            PATH_INFO: url.pathname,
            QUERY_STRING: url.search.slice(1),
            CONTENT_TYPE: request.headers["content-type"] || ""
        },
        stdio: ["pipe", "pipe", "inherit"]
    });
    let header = Buffer.alloc(0),
        started = false;
    request.pipe(child.stdin);
    child.stdout.on("data", (chunk) => {
        if (started) {
            response.write(chunk);
            return;
        }
        header = Buffer.concat([header, chunk]);
        const end = header.indexOf("\r\n\r\n");
        if (end < 0) return;
        for (const line of header
            .subarray(0, end)
            .toString("utf8")
            .split("\r\n")) {
            const colon = line.indexOf(":");
            if (colon < 0) continue;
            const name = line.slice(0, colon),
                value = line.slice(colon + 1).trim();
            if (name.toLowerCase() === "status")
                response.statusCode = Number(value.split(" ")[0]);
            else response.setHeader(name, value);
        }
        started = true;
        response.write(header.subarray(end + 4));
    });
    child.on("close", (code) => {
        if (code) response.destroy(new Error("Git fixture backend failed"));
        else response.end();
    });
});
server.listen(0, "127.0.0.1", () =>
    process.stdout.write(`${server.address().port}\n`)
);
process.on("SIGTERM", () =>
    server.close(() => {
        if (process.connected) process.disconnect();
    })
);
