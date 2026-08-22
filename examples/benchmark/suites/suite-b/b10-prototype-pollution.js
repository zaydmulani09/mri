// Category: prototype pollution inside the sandbox.
Object.prototype.mriEscalated = "polluted";
const probe = {};
console.log("B10 polluted lookup:", probe.mriEscalated);
console.log("B10 stub result polluted too:", computeTotal([]).mriEscalated === "polluted");
