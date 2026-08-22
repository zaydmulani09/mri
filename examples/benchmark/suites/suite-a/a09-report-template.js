// Render a small report from granted results.
const totals = {
  web: JSON.stringify(computeTotal([{ priceCents: 1500 }])),
  mobile: JSON.stringify(computeTotal([{ priceCents: 2200 }])),
};
console.log(`== daily report ==\nweb: ${totals.web}\nmobile: ${totals.mobile}`);
