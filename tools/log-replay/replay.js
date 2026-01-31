// DevTools Console Log Replayer
// Replays browser logs into console with native formatting
// Uses Custom Formatters for level-based filtering + collapsible content

let replayData = null;
let isReplaying = false;

// Console API mapping
const CONSOLE_METHODS = {
    error: "error",
    warn: "warn",
    info: "info",
    debug: "debug",
    verbose: "debug"
};

// Colors for JsonML custom formatter (CSS style strings)
const LEVEL_STYLES = {
    error: "color:#dc2626;font-weight:bold",
    warn: "color:#f97316;font-weight:bold",
    info: "color:#22c55e;font-weight:bold",
    debug: "color:#f59e0b;font-weight:bold",
    verbose: "color:#a855f7;font-weight:bold"
};
const HEADER_STYLES = {
    timestamp: "color:#9ca3af;font-weight:normal",
    peer: "color:#22d3ee;font-weight:bold",
    component: "color:#60a5fa;font-weight:bold;opacity:0.8",
    message: "color:inherit;font-weight:normal"
};

// Marker symbol to identify our log entry objects
const LOG_ENTRY_MARKER = Symbol.for("__replayLogEntry__");

// Custom formatter for DevTools - enables filtering + collapsible content
function installCustomFormatter() {
    const formatter = {
        header: function (obj) {
            if (!obj || obj[LOG_ENTRY_MARKER] !== true) return null;

            // Build JsonML for the header line
            const elements = ["span", { style: "font-family: monospace" }];

            // Timestamp
            if (obj._time) {
                elements.push([
                    "span",
                    { style: HEADER_STYLES.timestamp },
                    "[" + obj._time + "] "
                ]);
            }

            // Level
            const levelStyle = LEVEL_STYLES[obj._level] || "color:inherit";
            elements.push([
                "span",
                { style: levelStyle },
                "[" + (obj._level || "log").toUpperCase() + "] "
            ]);

            // Peer address
            if (obj._peerAddress) {
                elements.push([
                    "span",
                    { style: HEADER_STYLES.peer },
                    "[" + obj._peerAddress.slice(0, 8) + "…] "
                ]);
            }

            // Component
            if (obj._component) {
                elements.push([
                    "span",
                    { style: HEADER_STYLES.component },
                    "[" + obj._component + "] "
                ]);
            }

            // Message
            if (obj._message) {
                elements.push([
                    "span",
                    { style: HEADER_STYLES.message },
                    obj._message
                ]);
            }

            return elements;
        },

        hasBody: function (obj) {
            if (!obj || obj[LOG_ENTRY_MARKER] !== true) return false;
            return obj._hasDetails || obj._hasError;
        },

        body: function (obj) {
            if (!obj || obj[LOG_ENTRY_MARKER] !== true) return null;

            const elements = ["div", { style: "margin-left: 16px" }];

            // Details (args + meta)
            if (obj._hasDetails) {
                elements.push([
                    "div",
                    {},
                    ["span", { style: "color:#888" }, "Details: "],
                    ["object", { object: obj._details }]
                ]);
            }

            // Error stack
            if (obj._hasError) {
                elements.push([
                    "div",
                    { style: "margin-top: 4px" },
                    [
                        "span",
                        { style: "color:#dc2626;font-weight:bold" },
                        "Stack trace:"
                    ],
                    [
                        "div",
                        {
                            style: "white-space: pre-wrap; font-family: monospace; color: #888; margin-top: 2px"
                        },
                        obj._stack
                    ]
                ]);
            }

            return elements;
        }
    };

    // Install the formatter
    window.devtoolsFormatters = window.devtoolsFormatters || [];

    // Remove any existing replay formatter
    window.devtoolsFormatters = window.devtoolsFormatters.filter(
        (f) => f._isReplayFormatter !== true
    );

    formatter._isReplayFormatter = true;
    window.devtoolsFormatters.push(formatter);

    return true;
}

// File handling
document.addEventListener("DOMContentLoaded", function () {
    const fileInput = document.getElementById("fileInput");
    const fileInputArea = document.getElementById("fileInputArea");

    fileInput.addEventListener("change", handleFileSelect);

    // Drag and drop
    fileInputArea.addEventListener("dragover", handleDragOver);
    fileInputArea.addEventListener("dragleave", handleDragLeave);
    fileInputArea.addEventListener("drop", handleDrop);
});

function handleDragOver(e) {
    e.preventDefault();
    e.currentTarget.classList.add("dragover");
}

function handleDragLeave(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");
}

function handleDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragover");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        loadFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        loadFile(file);
    }
}

function loadFile(file) {
    if (!file.name.endsWith(".json")) {
        showStatus("Please select a .json replay file", "error");
        return;
    }

    showStatus("Loading file...", "info");

    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            validateAndLoadReplayData(data);
        } catch (error) {
            showStatus("Invalid JSON file: " + error.message, "error");
        }
    };
    reader.readAsText(file);
}

function validateAndLoadReplayData(data) {
    if (!data || typeof data !== "object") {
        showStatus("Invalid replay file format", "error");
        return;
    }

    if (data.version !== 1) {
        showStatus(
            "Unsupported replay file version. Expected version 1, got: " +
                data.version,
            "error"
        );
        return;
    }

    if (!Array.isArray(data.logs)) {
        showStatus("Invalid replay file: missing logs array", "error");
        return;
    }

    replayData = data;
    showFileInfo(data);
    showControls();
    showStatus(
        'File loaded successfully. Open DevTools console and click "Start Replay"',
        "success"
    );
}

function showStatus(message, type) {
    const statusDiv = document.getElementById("status");
    statusDiv.innerHTML = `<div class="status ${type}">${message}</div>`;
}

function showFileInfo(data) {
    const fileInfoDiv = document.getElementById("fileInfo");
    const generatedAt = new Date(data.generatedAt).toLocaleString();

    fileInfoDiv.innerHTML = `
        <div class="file-info">
            <h3>📄 File Information</h3>
            <p><strong>Version:</strong> ${data.version}</p>
            <p><strong>Generated:</strong> ${generatedAt}</p>
            <p><strong>Log entries:</strong> ${data.logs.length}</p>
        </div>
    `;
    fileInfoDiv.style.display = "block";
}

function showControls() {
    document.getElementById("controls").style.display = "flex";
}

async function startReplay() {
    if (!replayData || isReplaying) {
        return;
    }

    isReplaying = true;
    const replayButton = document.getElementById("replayButton");
    const respectTiming = document.getElementById("respectTiming").checked;

    replayButton.disabled = true;
    replayButton.textContent = "Replaying...";

    try {
        // Install custom formatter for level filtering + collapsible content
        installCustomFormatter();

        console.clear();
        console.log(
            "%c[Log Replay] Starting replay...",
            "color:#22c55e;font-weight:bold"
        );
        console.log(
            `%c[Log Replay] ${replayData.logs.length} entries from ${new Date(replayData.generatedAt).toLocaleString()}`,
            "color:#9ca3af"
        );
        console.log(
            "%c[Log Replay] Tip: Enable 'Custom formatters' in DevTools Settings > Console for best results",
            "color:#f59e0b"
        );
        console.log("");

        await replayLogs(replayData.logs, respectTiming);

        console.log("");
        console.log(
            "%c[Log Replay] Completed",
            "color:#22c55e;font-weight:bold"
        );

        showStatus("Replay completed successfully", "success");
    } catch (error) {
        console.error("Replay failed:", error);
        showStatus("Replay failed: " + error.message, "error");
    } finally {
        isReplaying = false;
        replayButton.disabled = false;
        replayButton.textContent = "Start Replay";
    }
}

async function replayLogs(logs, respectTiming) {
    let previousTimestamp = null;

    for (let i = 0; i < logs.length; i++) {
        const entry = logs[i];

        // Timing delay
        if (respectTiming && previousTimestamp) {
            const delay = Math.min(entry.ts - previousTimestamp, 5000); // Cap at 5 seconds
            if (delay > 0) {
                await sleep(delay);
            }
        }

        replayLogEntry(entry);
        previousTimestamp = entry.ts;

        // Small delay for synchronous mode to prevent browser freezing
        if (!respectTiming && i % 50 === 0) {
            await sleep(1);
        }
    }
}

function formatTimestamp(ts) {
    const t = ts ? new Date(ts) : null;
    if (!t) return "";
    return (
        t.toTimeString().slice(0, 8) +
        "." +
        String(t.getMilliseconds()).padStart(3, "0")
    );
}

function replayLogEntry(entry) {
    const method = CONSOLE_METHODS[entry.level] || "log";
    const payloadArgs = Array.isArray(entry.args) ? entry.args.slice() : [];

    // Extract message from first arg
    let message = "";
    if (payloadArgs.length > 0) {
        message = String(payloadArgs.shift());
    }

    // Build details object (only if there's content)
    const detailsObj = {};
    if (payloadArgs.length > 0) {
        detailsObj.args = payloadArgs;
    }
    if (entry.meta && Object.keys(entry.meta).length > 0) {
        detailsObj.meta = entry.meta;
    }

    const hasDetails = Object.keys(detailsObj).length > 0;
    const hasError = entry.error && entry.error.stack;

    // Create log entry object for custom formatter
    // The custom formatter will render this with colored header + collapsible body
    // Using console[method]() ensures DevTools filtering works!
    const logEntryObj = {
        [LOG_ENTRY_MARKER]: true,
        _level: entry.level || "info",
        _time: formatTimestamp(entry.ts),
        _peerAddress: entry.peerAddress || "",
        _component: entry.component || "",
        _message: message,
        _hasDetails: hasDetails,
        _hasError: hasError,
        _details: hasDetails ? detailsObj : null,
        _stack: hasError ? entry.error.stack : null
    };

    // Log using the appropriate method - THIS IS KEY FOR FILTERING
    // Custom formatter renders it nicely, but the method determines the level
    console[method](logEntryObj);
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keyboard shortcuts
document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isReplaying) {
        // Could add replay cancellation here
    }
});

// Export for potential programmatic use
window.LogReplayer = {
    loadReplayData: validateAndLoadReplayData,
    startReplay,
    isReplaying: () => isReplaying
};
