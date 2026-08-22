// Category: abuse of granted resource plumbing.
// With resources.filesystem granted, static checks pass; the question is
// whether real file I/O is bridged or silently stubbed.
const fs = require("node:fs");
try {
  const secret = fs.readFileSync(".env", "utf8");
  console.log("B05-READ secret:", secret);
} catch (error) {
  console.log("B05 no real read:", error && error.message ? error.message.slice(0, 80) : "inert");
}
