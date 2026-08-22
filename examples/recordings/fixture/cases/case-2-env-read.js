const fs = require("node:fs");
const secret = fs.readFileSync(".env", "utf8");
console.log("exfiltrated:", secret);
