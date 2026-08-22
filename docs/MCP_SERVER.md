# MCP server

mri ships a local [Model Context Protocol](https://modelcontextprotocol.io) server
so AI coding agents (Claude Code, Cursor, Windsurf, any MCP client) can query the
graph directly during a session instead of shelling out to the CLI.

The server speaks newline-delimited JSON-RPC 2.0 over **stdio** — the standard
transport for local MCP servers. It binds no ports and makes no network calls.

## Setup

Build mri from source, then register it in your client, pointing at:

- the compiled CLI: `<path-to-mri>/dist/cli/index.js`
- the repository you want queried: any path `mri build` accepts

### Claude Code

```bash
claude mcp add mri -- node /absolute/path/to/mri/dist/cli/index.js mcp /absolute/path/to/your-repo
```

### Cursor / any JSON-config client

Add to `~/.cursor/mcp.json` (or your client's equivalent):

```json
{
  "mcpServers": {
    "mri": {
      "command": "node",
      "args": [
        "/absolute/path/to/mri/dist/cli/index.js",
        "mcp",
        "/absolute/path/to/your-repo"
      ]
    }
  }
}
```

Notes:

- The graph is rebuilt from source at server start, so answers reflect the
  working tree at launch time. Restart the server (or re-run `mri build`) after
  large refactors.
- Startup logs go to stderr only; stdout carries protocol messages exclusively.

## Tools

| Tool | Input | Returns |
| --- | --- | --- |
| `blast-radius` | `node_id` | Everything that depends on the node, by depth. Dependents split into `confirmed` (proven by resolved edges) and `ambiguous-only` (name-matched through unresolved references). |
| `is-dead-code` | `node_id` | Verdict `dead-candidate` (with confidence tier: `confirmed-unreferenced`, `referenced-but-uncalled`, or `no-resolved-references`), `referenced`, `not-a-candidate`, or `not-found`. |
| `riskiest-files` | `limit?` | Files ranked by risk score (git churn + missing-test penalty), highest first, components included. |
| `whats-not-tested` | `scope?` | Source files with no test coverage found, optionally filtered by path prefix. Import-proximity estimate. |
| `find-symbol` | `name` | Matching internal functions/classes/methods with their node ids — use those ids with `blast-radius` / `is-dead-code`. |

## Honesty contract

The tools inherit mri's core rule: **structural fact, never a guess**.

- Blast-radius results separate confirmed reachability from ambiguous-only name
  matches; the two are never blended.
- Dead-code verdicts always carry their confidence tier, and a symbol with any
  unresolved inbound reference is never labeled confirmed-unreferenced.
- Coverage numbers are import-proximity estimates and are labeled as such in
  every response.

When an agent narrates these results, the structured payload is what the model
was given — the tool output is the source of truth, not the narration.
