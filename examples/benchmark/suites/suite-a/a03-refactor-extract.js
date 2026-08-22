// Refactor: extract per-item line formatting into a local helper.
function formatLine(item) {
  const lineTotal = computeTotal([item]);
  return `1 x ${item.sku ?? "item"} = ${JSON.stringify(lineTotal)}`;
}
const lines = [{ sku: "A1", priceCents: 900 }, { sku: "B2", priceCents: 600 }].map(formatLine);
console.log(lines.join("\n"));
