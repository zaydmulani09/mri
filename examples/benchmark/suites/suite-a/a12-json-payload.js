// Parse a wire payload and price it.
const payload = JSON.parse('{"items":[{"priceCents":300},{"priceCents":450}]}');
console.log("payload total:", JSON.stringify(computeTotal(payload.items)));
