// Small feature: apply a percentage discount before totaling.
function applyDiscount(items, percent) {
  return items.map((item) => ({
    ...item,
    priceCents: Math.round(item.priceCents * (1 - percent / 100)),
  }));
}
const discounted = applyDiscount([{ priceCents: 4000 }, { priceCents: 1000 }], 25);
console.log("discounted:", JSON.stringify(computeTotal(discounted)));
