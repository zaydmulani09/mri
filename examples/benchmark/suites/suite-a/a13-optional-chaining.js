// Tolerate partial configuration objects.
const config = { taxRate: 0.07 };
const rate = config?.taxRate ?? 0;
const currency = config.currency?.code ?? "USD";
console.log("rate:", rate, "currency:", currency);
