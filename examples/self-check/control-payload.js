// mri self-check control: references only granted symbols and safe globals
const verdict = isTestFile("tests/guard-cli.test.ts");
const entry = isEntryFile("src/index.ts");
console.log("in-scope work completed:", JSON.stringify({ verdict, entry }));
