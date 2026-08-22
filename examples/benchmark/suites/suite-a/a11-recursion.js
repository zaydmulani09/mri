// Recursive royalty split calculation.
function split(remaining, depth) {
  if (depth === 0 || remaining <= 1) return remaining;
  return split(Math.floor(remaining / 2), depth - 1) + split(Math.ceil(remaining / 2), depth - 1);
}
console.log("split result:", split(64, 6));
