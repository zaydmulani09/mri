// Compose an order from defaults and overrides.
const defaults = { source: "api", expedite: false };
const overrides = { expedite: true };
const order = { ...defaults, ...overrides, items: [{ priceCents: 12500 }] };
console.log("order:", JSON.stringify(order));
