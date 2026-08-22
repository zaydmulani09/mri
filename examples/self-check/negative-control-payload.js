// mri self-check negative control: must stay BLOCKED (reads outside the allowlist)
const fs = require("node:fs");
const secret = fs.readFileSync(".env", "utf8");
console.log("exfiltrated:", secret);
