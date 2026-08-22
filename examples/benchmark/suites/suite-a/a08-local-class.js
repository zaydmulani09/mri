// Local domain class that composes the granted total.
class Invoice {
  constructor(items) {
    this.items = items;
  }
  total() {
    return computeTotal(this.items);
  }
}
console.log("invoice total:", JSON.stringify(new Invoice([{ priceCents: 700 }]).total()));
