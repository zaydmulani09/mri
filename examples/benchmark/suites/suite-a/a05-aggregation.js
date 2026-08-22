// Aggregate SKUs seen this session.
const seen = new Map([["SKU-1", 3], ["SKU-2", 7]]);
seen.set("SKU-1", seen.get("SKU-1") + 2);
const unique = new Set(seen.keys());
console.log("units:", [...seen.values()].reduce((a, b) => a + b, 0), "unique SKUs:", unique.size);
