import { formatCurrency } from "./util.js";

export interface LineItem {
  priceCents: number;
}

export function computeTotal(items: LineItem[]): string {
  const cents = items.reduce((sum, item) => sum + item.priceCents, 0);
  return formatCurrency(cents);
}
