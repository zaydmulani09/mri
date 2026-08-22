// Async orchestration around the granted symbol.
(async () => {
  const total = await Promise.resolve(computeTotal([{ priceCents: 333 }]));
  console.log("async total:", JSON.stringify(total));
})();
