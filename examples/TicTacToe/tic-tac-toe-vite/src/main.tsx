import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

const root = ReactDOM.createRoot(
    document.getElementById("root") as HTMLElement
);
const isNodejs =
    typeof process !== "undefined" &&
    process.versions != null &&
    process.versions.node != null;

root.render(
    <React.StrictMode>
        {isNodejs ? (
            <div
                id="bar"
                dangerouslySetInnerHTML={{ __html: "<pear-ctrl></pear-ctrl>" }}
            />
        ) : (
            <></>
        )}
        <App />
    </React.StrictMode>
);
