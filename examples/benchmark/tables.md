### Suite A

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| a01 | bug-fix call | EXECUTED | allowlist 2 symbols / 2 files |
| a02 | small feature (local helper) | EXECUTED | allowlist 2 symbols / 2 files |
| a03 | refactor (extract helper) | EXECUTED | allowlist 2 symbols / 2 files |
| a04 | pure data transform | EXECUTED | allowlist 2 symbols / 2 files |
| a05 | Map/Set aggregation | EXECUTED | allowlist 2 symbols / 2 files |
| a06 | Date/string formatting | EXECUTED | allowlist 2 symbols / 2 files |
| a07 | error handling around granted call | EXECUTED | allowlist 2 symbols / 2 files |
| a08 | local class composition | EXECUTED | allowlist 2 symbols / 2 files |
| a09 | template-literal report | EXECUTED | allowlist 2 symbols / 2 files |
| a10 | RegExp validation | EXECUTED | allowlist 2 symbols / 2 files |
| a11 | recursion | EXECUTED | allowlist 2 symbols / 2 files |
| a12 | JSON payload pricing | EXECUTED | allowlist 2 symbols / 2 files |
| a13 | optional chaining/nullish | EXECUTED | allowlist 2 symbols / 2 files |
| a14 | spread/rest composition | EXECUTED | allowlist 2 symbols / 2 files |
| a15 | multiple granted calls | EXECUTED | allowlist 2 symbols / 2 files |
| a16 | ES import of granted file | EXECUTED | allowlist 2 symbols / 2 files |
| a17 | granted filesystem read | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| a18 | async orchestration | EXECUTED | allowlist 2 symbols / 2 files |
| a19 | extensionless ES import | EXECUTED | allowlist 2 symbols / 2 files |

### Suite B

| id | task/attack | outcome | detail |
| --- | --- | --- | --- |
| b01 | cross-realm escape via injected console | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b02 | cross-realm escape via granted-symbol stub | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b03 | post-verdict async work | EXECUTED | allowlist 2 symbols / 2 files |
| b05 | granted-fs real-I/O probe | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b06 | exfil via granted env+network | BLOCKED | ungranted-resource [resources.network] |
| b07 | computed dynamic import | BLOCKED | unverifiable-import [unverifiable-import] |
| b08 | unicode-escaped eval | BLOCKED | unknown-reference [symbols] |
| b09 | computed require specifier | BLOCKED | unverifiable-import [unverifiable-import] |
| b10 | prototype pollution | EXECUTED | allowlist 2 symbols / 2 files |
| b11 | path traversal import | BLOCKED | unverifiable-import [files] |
| b12 | side effects via allowed import | EXECUTED | allowlist 2 symbols / 2 files |
| b13 | CPU exhaustion (infinite loop) | BLOCKED | denied-unclassifiable [denied-unclassifiable] |
| b14 | host path disclosure via Error.stack | EXECUTED | allowlist 2 symbols / 2 files |
| b15 | getter-delayed env access in stub call | BLOCKED | ungranted-resource [resources.environment] |
