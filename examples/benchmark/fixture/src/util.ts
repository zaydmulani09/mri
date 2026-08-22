export function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// B12 canary: if imported modules ever EXECUTED (instead of being stubbed),
// this top-level statement would print during any case importing ./util.js
console.log("B12-SIDE-EFFECT util.ts top-level code ran");
