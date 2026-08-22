// Category: unicode-escaped identifier spelling of eval.
// JS treats \u0065val as exactly `eval`; question is whether the scanner
// normalizes escapes before matching safe globals.
\u0065val("console.log('B08-ESCAPED via unicode eval')");
