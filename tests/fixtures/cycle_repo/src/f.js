// The call below lands on obj.hop() where obj is an unresolvable parameter,
// so the edge to g.js's hop stays ambiguous. A naive name-matching detector
// would see landing -> hop -> landing as a cycle; mri must not.
export function landing(obj) {
  return obj.hop();
}
