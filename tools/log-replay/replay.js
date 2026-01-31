// DevTools Console Log Replayer
// Replays browser logs into console with native formatting

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

// DevTools %c colors (header only) - match native DevTools exactly
const LEVEL_COLORS = {
    error: "color:#dc2626;font-weight:bold",
    warn: "color:#f97316;font-weight:bold",
    info: "color:#22c55e;font-weight:bold",
    debug: "color:#f59e0b;font-weight:bold",
    verbose: "color:#a855f7;font-weight:bold"
};
const HEADER_COLORS = {
    timestamp: "color:#9ca3af;font-weight:normal",
    peer: "color:#22d3ee;font-weight:bold",
    component: "color:#60a5fa;font-weight:bold;opacity:0.8" // slightly muted like native DevTools
};

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
        console.clear();
        console.log("Starting log replay...");
        console.log(
            `Replaying ${replayData.logs.length} log entries from ${new Date(replayData.generatedAt).toLocaleString()}`
        );
        console.log("");

        await replayLogs(replayData.logs, respectTiming);

        console.log("");
        console.log("Replay completed");

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

function buildColoredHeader(entry) {
    let headerStr = "";
    const styles = [];
    const t = entry.ts ? new Date(entry.ts) : null;
    const time = t
        ? t.toTimeString().slice(0, 8) +
          "." +
          String(t.getMilliseconds()).padStart(3, "0")
        : "";

    if (time) {
        headerStr += "%c[" + time + "]";
        styles.push(HEADER_COLORS.timestamp);
    }
    headerStr += " %c[" + (entry.level || "log").toUpperCase() + "]";
    styles.push(LEVEL_COLORS[entry.level] || "color:inherit");

    if (entry.peerAddress) {
        headerStr += " %c[" + entry.peerAddress.slice(0, 8) + "…]";
        styles.push(HEADER_COLORS.peer);
    }
    if (entry.component) {
        headerStr += " %c[" + entry.component + "]";
        styles.push(HEADER_COLORS.component);
    }

    return [headerStr, styles];
}

function replayLogEntry(entry) {
    const method = CONSOLE_METHODS[entry.level] || "log";
    const [headerStr, headerStyles] = buildColoredHeader(entry);
    const payloadArgs = entry.args ?? [];

    // Create Error object if present
    let errorObj;
    if (entry.error) {
        errorObj = new Error(entry.error.message || "Error");
        if (entry.error.stack) errorObj.stack = entry.error.stack;
    }

    // Build the complete header including the message
    // This should be: "[timestamp] [LEVEL] [peer] [component] message"
    // Message uses default console text color (white in dark mode, black in light mode)
    const MESSAGE_STYLE = "color:inherit;font-weight:normal";
    let fullHeaderStr = headerStr;
    let fullHeaderStyles = [...headerStyles];

    // Add the message to the header with its own style so it's not component-colored
    if (payloadArgs.length > 0) {
        const messageText = payloadArgs.map((a) => String(a)).join(" ");
        fullHeaderStr += " %c" + messageText;
        fullHeaderStyles.push(MESSAGE_STYLE);
    }

    // Determine what expandable content we have (only meta and errors)
    const hasExpandableContent =
        (entry.meta && Object.keys(entry.meta).length > 0) || errorObj;

    if (hasExpandableContent) {
        // Only create a group if there's actually expandable content (meta or error)
        const groupMethod =
            entry.level === "error" || entry.level === "warn"
                ? "group" // expanded by default for errors/warnings
                : "groupCollapsed"; // collapsed by default for info/debug/verbose

        // Start group with the full header including message
        console[groupMethod](fullHeaderStr, ...fullHeaderStyles);

        // Add metadata object if it exists and has content
        if (entry.meta && Object.keys(entry.meta).length > 0) {
            console.log(entry.meta);
        }

        // Add error object for proper DevTools stack trace rendering
        if (errorObj) {
            console.error(errorObj);
        }

        // End the group
        console.groupEnd();
    } else {
        // No expandable content - just emit a single log line
        console[method](fullHeaderStr, ...fullHeaderStyles);
    }
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
