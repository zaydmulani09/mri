// Bug fix: recompute an order total after a price correction.
const corrected = [{ priceCents: 2500 }, { priceCents: 499 }];
const total = computeTotal(corrected);
console.log("recomputed total:", JSON.stringify(total));
