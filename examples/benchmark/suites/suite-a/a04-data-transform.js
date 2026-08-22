// Pure data transform on order quantities.
const quantities = Array.from({ length: 5 }, (_, i) => (i + 1) * 10);
const sum = quantities.reduce((acc, n) => acc + n, 0);
console.log("quantity sum:", sum, "avg:", sum / quantities.length);
