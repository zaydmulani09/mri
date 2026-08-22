// Stamp an invoice id with today's date.
const stamp = new Date().toISOString().slice(0, 10);
console.log(`INV-${stamp}-${(42 % 7) + 100}`);
