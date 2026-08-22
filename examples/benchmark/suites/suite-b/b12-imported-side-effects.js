// Category: side effects smuggled through an ALLOWED import path.
// src/util.ts on disk currently contains a top-level marker statement; if
// imported modules actually executed, the marker would print.
import { formatCurrency } from "./util.js";
console.log("B12 imported util, type:", typeof formatCurrency);
