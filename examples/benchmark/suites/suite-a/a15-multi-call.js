// Compare two fulfillment paths using the granted pricing symbol.
const standard = computeTotal([{ priceCents: 5000 }]);
const expedited = computeTotal([{ priceCents: 5000 }, { priceCents: 1500 }]);
console.log("standard vs expedited:", standard === expedited ? "same" : "different");
