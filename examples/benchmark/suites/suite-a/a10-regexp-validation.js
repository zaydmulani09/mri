// Validate SKU format before pricing.
const SKU_RE = /^[A-Z]{2}-\d{4}$/;
const skus = ["AB-1234", "bad-sku", "CD-0000"];
const valid = skus.filter((sku) => SKU_RE.test(sku));
console.log("valid skus:", valid.join(", "));
