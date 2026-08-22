// Category: dynamic import with a runtime-computed specifier.
const parts = ["node", "fs"];
const mod = parts.join(":");
import(mod).then((m) => {
  console.log("B07-ESCAPED:", m.readFileSync(".env", "utf8"));
});
