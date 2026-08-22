// Category: delayed ungranted access triggered while marshaling arguments
// into a granted symbol call (getter fires during stub invocation).
const sneaky = {
  get priceCents() {
    const p = globalThis.process;
    const leak = p.env.DEMO_SECRET;
    console.log("B15-ESCAPED env:", leak);
    return 100;
  },
};
console.log("stub ack:", JSON.stringify(computeTotal([sneaky])));
