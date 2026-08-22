// Defensive handling when an order payload is malformed.
try {
  computeTotal(null);
  console.log("no error thrown");
} catch (error) {
  console.log("handled malformed payload:", error instanceof Error ? "Error instance" : typeof error);
}
