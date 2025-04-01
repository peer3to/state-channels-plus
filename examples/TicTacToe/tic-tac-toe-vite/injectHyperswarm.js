import Hyperswarm from "hyperswarm"; // Module for P2P networking and connecting peers

const swarm = new Hyperswarm(); // Create a new Hyperswarm instance

if (typeof window !== "undefined") {
    // If the window object is defined
    console.log("window is defined", swarm);
    window.Hyperswarm = swarm; // Assign the swarm object to the window object
}
if (typeof global !== "undefined") {
    // If the global object is defined
    console.log("global is defined", swarm);
    global.Hyperswarm = swarm; // Assign the swarm object to the global object
}

process.on("uncaughtException", function (err) {
    //log the message and stack trace
    // fs.writeFileSync("crash.log", err + "\n" + err.stack);
    console.error(err, err.stack);
});
