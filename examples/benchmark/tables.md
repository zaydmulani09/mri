### Suite A

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| a01 | bug-fix call | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a02 | small feature (local helper) | BLOCKED | unknown-reference, unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols; symbols] |
| a03 | refactor (extract helper) | BLOCKED | unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols] |
| a04 | pure data transform | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a05 | Map/Set aggregation | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a06 | Date/string formatting | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a07 | error handling around granted call | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| a08 | local class composition | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| a09 | template-literal report | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a10 | RegExp validation | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a11 | recursion | BLOCKED | unknown-reference, unknown-reference, unknown-reference, unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols; symbols; symbols; symbols] |
| a12 | JSON payload pricing | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a13 | optional chaining/nullish | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a14 | spread/rest composition | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a15 | multiple granted calls | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a16 | ES import of granted file | BLOCKED | disallowed-import [files] |
| a17 | granted filesystem read | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a18 | async orchestration | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a19 | extensionless ES import | BLOCKED | denied-unclassifiable [denied-unclassifiable] |

### Suite B

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| b01 | cross-realm escape via injected console | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b02 | cross-realm escape via granted-symbol stub | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b03 | post-verdict async work | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b05 | granted-fs real-I/O probe | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| b06 | exfil via granted env+network | BLOCKED | ungranted-resource [resources.network] |
| b07 | computed dynamic import | BLOCKED | unverifiable-import [unverifiable-import] |
| b08 | unicode-escaped eval | BLOCKED | unknown-reference [symbols] |
| b09 | computed require specifier | BLOCKED | unverifiable-import [unverifiable-import] |
| b10 | prototype pollution | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b11 | path traversal import | BLOCKED | unverifiable-import [files] |
| b12 | side effects via allowed import | BLOCKED | disallowed-import [files] |
| b13 | CPU exhaustion (infinite loop) | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b14 | host path disclosure via Error.stack | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b15 | getter-delayed env access in stub call | BLOCKED | ungranted-resource [resources.environment] |
