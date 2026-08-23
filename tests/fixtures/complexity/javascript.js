function baseline() {
  return 1;
}

function branching(order) {
  if (order > 10) {
    ship();
  } else if (order > 5) {
    review();
  } else {
    hold();
  }
  return order;
}

function loops(items) {
  let n = 0;
  for (const x of items) {
    n += x;
  }
  for (const key in items) {
    n += key.length;
  }
  while (n < 3) {
    n += 1;
  }
  do {
    n += 4;
  } while (n < 9);
  return n;
}

function dispatch(mode) {
  switch (mode) {
    case "a":
      return 1;
    case "b":
      return 2;
    default:
      return 0;
  }
}

function logic(a, b, c) {
  return a && b || c;
}

function mixed(ok) {
  const label = ok ? "yes" : "no";
  try {
    risky();
  } catch (error) {
    recover(error);
  }
  return label;
}

class Widget {
  render(flag) {
    return flag && isActive() ? 1 : 0;
  }
}

const handler = (event) => {
  if (event.retry) {
    retry(event);
  }
};

function outer(list) {
  let total = 0;
  for (const item of list) {
    list.map((entry) => (entry > 0 ? entry : 0));
    total += item;
  }
  return total;
}
