// Startup environment verification for the mri CLI. Every failure produces an
// actionable message instead of a cryptic stack trace from deep inside
// node:sqlite or a tree-sitter native binding.

export interface RuntimeCheckResult {
  ok: boolean;
  message: string;
}

interface NodeVersion {
  major: number;
  minor: number;
}

const MIN_NODE: NodeVersion = { major: 22, minor: 5 };

function parseNodeVersion(): NodeVersion | null {
  const match = /^v(\d+)\.(\d+)/.exec(process.version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]) };
}

function versionAtLeast(version: NodeVersion, min: NodeVersion): boolean {
  return (
    version.major > min.major ||
    (version.major === min.major && version.minor >= min.minor)
  );
}

/**
 * Verify the runtime can run the given command.
 * `needsGrammars` commands parse source files and require working tree-sitter
 * native bindings; the rest only need node:sqlite.
 */
export async function checkRuntime(command: string): Promise<RuntimeCheckResult> {
  const needsGrammars = command !== "blast-radius";

  const version = parseNodeVersion();
  if (!version || !versionAtLeast(version, MIN_NODE)) {
    return {
      ok: false,
      message:
        `mri requires Node.js >= ${MIN_NODE.major}.${MIN_NODE.minor}, but found ${process.version}.\n` +
        "mri stores its code graph in node:sqlite, which is only available from that version on.\n" +
        "Upgrade Node.js (https://nodejs.org) and try again.",
    };
  }

  try {
    const { DatabaseSync } = await import("node:sqlite");
    const probe = new DatabaseSync(":memory:");
    probe.exec("CREATE TABLE t (x)");
    probe.close();
  } catch (error) {
    return {
      ok: false,
      message:
        `mri could not load node:sqlite (${(error as Error).message}).\n` +
        `Node ${process.version} reports as available but node:sqlite is missing - this\n` +
        "usually means running inside a build of Node without SQLite support.\n" +
        "Install a standard Node.js >= 22.5 release and try again.",
    };
  }

  if (needsGrammars) {
    try {
      const ParserModule = await import("tree-sitter");
      const Parser = (ParserModule as unknown as { default: new () => TreeSitterParser }).default;
      const parser = new Parser();
      const grammar = await import("tree-sitter-javascript");
      parser.setLanguage((grammar as unknown as { default: unknown }).default);
      const tree = parser.parse("const mri = 1;");
      if (!tree.rootNode) throw new Error("parser returned no tree");
    } catch (error) {
      const detail = (error as Error).message.split("\n")[0] ?? "";
      return {
        ok: false,
        message:
          `mri could not load its tree-sitter parsers (${detail}).\n` +
          "The native bindings are missing or were built for a different Node/ABI version.\n" +
          "Fix inside the mri package directory with:\n" +
          "  npm rebuild tree-sitter tree-sitter-javascript tree-sitter-typescript tree-sitter-python tree-sitter-go\n" +
          "If npm rebuild is unavailable, reinstall the package so the prebuilt binaries for\n" +
          "your platform are fetched again.",
      };
    }
  }

  if (command === "guard") {
    try {
      const ivmModule = await import("isolated-vm");
      const ivm =
        (ivmModule as unknown as { default?: { Isolate: new () => { dispose(): void } } })
          .default ?? (ivmModule as unknown as { Isolate: new () => { dispose(): void } });
      const isolate = new ivm.Isolate();
      isolate.dispose();
    } catch (error) {
      return {
        ok: false,
        message:
          "mri guard requires the isolated-vm native module (" +
          (error as Error).message.split("\n")[0] +
          ").\nReinstall the package so the prebuilt binary for your platform is\nfetched, or run `npm rebuild isolated-vm` inside the mri package directory.",
      };
    }
  }

  return { ok: true, message: "" };
}

interface TreeSitterParser {
  setLanguage(grammar: unknown): void;
  parse(source: string): { rootNode: unknown };
}
