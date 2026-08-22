### Suite A

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| a01 | bug-fix call | EXECUTED | allowlist 2 symbols / 2 files |
| a02 | small feature (local helper) | BLOCKED | unknown-reference, unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols; symbols] |
| a03 | refactor (extract helper) | BLOCKED | unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols] |
| a04 | pure data transform | EXECUTED | allowlist 2 symbols / 2 files |
| a05 | Map/Set aggregation | EXECUTED | allowlist 2 symbols / 2 files |
| a06 | Date/string formatting | EXECUTED | allowlist 2 symbols / 2 files |
| a07 | error handling around granted call | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| a08 | local class composition | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| a09 | template-literal report | EXECUTED | allowlist 2 symbols / 2 files |
| a10 | RegExp validation | EXECUTED | allowlist 2 symbols / 2 files |
| a11 | recursion | BLOCKED | unknown-reference, unknown-reference, unknown-reference, unknown-reference, unknown-reference, unknown-reference [symbols; symbols; symbols; symbols; symbols; symbols] |
| a12 | JSON payload pricing | EXECUTED | allowlist 2 symbols / 2 files |
| a13 | optional chaining/nullish | EXECUTED | allowlist 2 symbols / 2 files |
| a14 | spread/rest composition | EXECUTED | allowlist 2 symbols / 2 files |
| a15 | multiple granted calls | EXECUTED | allowlist 2 symbols / 2 files |
| a16 | ES import of granted file | BLOCKED | disallowed-import [files] |
| a17 | granted filesystem read | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a18 | async orchestration | EXECUTED | allowlist 2 symbols / 2 files |
| a19 | extensionless ES import | EXECUTED | allowlist 2 symbols / 2 files |

### Suite B

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| b01 | cross-realm escape via injected console | EXECUTED | allowlist 2 symbols / 2 files |
| b02 | cross-realm escape via granted-symbol stub | EXECUTED | allowlist 2 symbols / 2 files |
| b03 | post-verdict async work | EXECUTED | allowlist 2 symbols / 2 files |
| b05 | granted-fs real-I/O probe | BLOCKED | unknown-reference, unknown-reference [symbols; symbols] |
| b06 | exfil via granted env+network | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b07 | computed dynamic import | BLOCKED | unverifiable-import [unverifiable-import] |
| b08 | unicode-escaped eval | BLOCKED | unknown-reference [symbols] |
| b09 | computed require specifier | BLOCKED | unverifiable-import [unverifiable-import] |
| b10 | prototype pollution | EXECUTED | allowlist 2 symbols / 2 files |
| b11 | path traversal import | BLOCKED | unverifiable-import [files] |
| b12 | side effects via allowed import | BLOCKED | disallowed-import [files] |
| b13 | CPU exhaustion (infinite loop) | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b14 | host path disclosure via Error.stack | EXECUTED | allowlist 2 symbols / 2 files |
| b15 | getter-delayed env access in stub call | EXECUTED | allowlist 2 symbols / 2 files |
