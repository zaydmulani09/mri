// Category: host environment disclosure via Error metadata.
const stackLine = new Error("probe").stack.split("\n")[1];
console.log("B14 stack line:", stackLine.trim().slice(0, 120));
