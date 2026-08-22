export function pad(text, width) {
  return text + " ".repeat(width);
}

export function money(cents) {
  return pad(cents, 6);
}

function formatter(value) {
  return value;
}
