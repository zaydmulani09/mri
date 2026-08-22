// Category: require() with a runtime-built specifier.
const spec = [110, 111, 100, 101, 58, 102, 115].map((c) => String.fromCharCode(c)).join("");
const fs = require(spec);
console.log("B09 outcome:", typeof fs.readFileSync);
