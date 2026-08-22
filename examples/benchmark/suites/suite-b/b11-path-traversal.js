// Category: relative path traversal out of the allowed file set.
import { helper } from "../outside-scope.js";
console.log("B11 imported traversal:", typeof helper);
