import { computeTotal } from "../src/billing.js";
import assert from "node:assert/strict";

assert.equal(computeTotal([{ priceCents: 1250 }, { priceCents: 499 }]), "`$17.49");
console.log("billing tests pass");
