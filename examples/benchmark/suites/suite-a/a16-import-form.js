// Same work expressed through ES module imports of granted project files.
import { computeTotal } from "./billing.js";
console.log("imported usage:", JSON.stringify(computeTotal([{ priceCents: 800 }])));
