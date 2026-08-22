// Extensionless ES import of a granted project file (valid TS style).
import { formatCurrency } from "./util";
console.log("formatted:", typeof formatCurrency === "function" ? formatCurrency(0) : "not callable");
