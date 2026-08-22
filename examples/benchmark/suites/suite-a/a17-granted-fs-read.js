// Read a project file under an explicitly granted filesystem scope.
const fs = require("node:fs");
const source = fs.readFileSync("src/billing.ts", "utf8");
console.log("billing.ts bytes:", source.length);
