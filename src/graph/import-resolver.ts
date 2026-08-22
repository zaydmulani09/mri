import {
  existsSync,
  promises as fs,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { LanguageId } from "../extraction/languages.js";

export type ImportStatus = "internal" | "external";

export interface ResolvedImport {
  specifier: string;
  status: ImportStatus;
  path?: string;
}

export interface ImportResolver {
  resolve(importerPath: string, specifier: string, language: LanguageId): ResolvedImport;
}

const JS_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function stripKnownExtension(p: string): string {
  const ext = path.extname(p);
  return JS_EXTENSIONS.includes(ext) ? p.slice(0, p.length - ext.length) : p;
}

function toPosixRelative(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

export function createImportResolver(rootDir: string): ImportResolver {
  const root = path.resolve(rootDir);

  function insideRoot(absPath: string): boolean {
    const rel = path.relative(root, absPath);
    return !rel.startsWith("..") && path.isAbsolute(rel) === false;
  }

  function resolveJs(importerPath: string, specifier: string): ResolvedImport {
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      return { specifier, status: "external" };
    }
    const importerAbs = path.join(root, importerPath);
    const base = path.resolve(path.dirname(importerAbs), specifier);
    const stem = stripKnownExtension(base);
    const candidates: string[] = [];
    for (const ext of JS_EXTENSIONS) candidates.push(stem + ext);
    if (isDir(base)) {
      for (const ext of JS_EXTENSIONS) candidates.push(path.join(base, `index${ext}`));
    }
    for (const candidate of candidates) {
      if (isFile(candidate)) {
        return { specifier, status: "internal", path: toPosixRelative(root, candidate) };
      }
    }
    return { specifier, status: "external" };
  }

  function resolvePythonModule(
    moduleDotted: string,
    fromDirAbs: string | null,
    specifierForReport: string,
  ): ResolvedImport {
    const parts = moduleDotted.split(".").filter((part) => part.length > 0);
    const searchRoot = fromDirAbs ?? root;
    const base = path.join(searchRoot, ...parts);
    const candidates = [`${base}.py`, path.join(base, "__init__.py")];
    for (const candidate of candidates) {
      if (isFile(candidate)) {
        if (!insideRoot(candidate)) {
          return { specifier: specifierForReport, status: "external" };
        }
        return {
          specifier: specifierForReport,
          status: "internal",
          path: toPosixRelative(root, candidate),
        };
      }
    }
    return { specifier: specifierForReport, status: "external" };
  }

  function resolve(
    importerPath: string,
    specifier: string,
    language: LanguageId,
  ): ResolvedImport {
    if (language === "python") {
      const leadingDots = specifier.match(/^\.+/)?.[0]?.length ?? 0;
      if (leadingDots > 0) {
        const rest = specifier.slice(leadingDots);
        const importerAbs = path.join(root, importerPath);
        let packageDir = path.dirname(importerAbs);
        for (let i = 1; i < leadingDots; i++) packageDir = path.dirname(packageDir);
        return resolvePythonModule(rest, packageDir, specifier);
      }
      return resolvePythonModule(specifier, null, specifier);
    }
    if (language === "go") {
      return resolveGoPackage(specifier);
    }
    return resolveJs(importerPath, specifier);
  }

  // Go imports are module-path based: a specifier is internal only when it
  // equals or extends the module path declared in <root>/go.mod, and the
  // corresponding package directory actually contains Go sources. Anything
  // else is external - there is no heuristic fallback to guess from.
  let goModulePathCache: string | null | undefined;

  function goModulePath(): string | null {
    if (goModulePathCache !== undefined) return goModulePathCache;
    goModulePathCache = null;
    try {
      const text = readFileSync(path.join(root, "go.mod"), "utf8");
      const match = /^\s*module\s+(\S+)\s*$/m.exec(text);
      if (match?.[1]) {
        goModulePathCache = match[1].replace(/^"|"$/g, "");
      }
    } catch {
      // no go.mod: every import stays external
    }
    return goModulePathCache;
  }

  function resolveGoPackage(specifier: string): ResolvedImport {
    const modulePath = goModulePath();
    if (modulePath === null) return { specifier, status: "external" };
    if (specifier !== modulePath && !specifier.startsWith(modulePath + "/")) {
      return { specifier, status: "external" };
    }

    const relDir = specifier.slice(modulePath.length).replace(/^\//, "");
    const packageDir = relDir.length === 0 ? root : path.join(root, ...relDir.split("/"));
    if (!isDir(packageDir)) return { specifier, status: "external" };

    // An import names a whole package; the graph's file-level model picks a
    // deterministic representative file (first .go file in sorted order) as
    // the edge destination.
    try {
      const entries = readdirSync(packageDir, { withFileTypes: true });
      const firstGoFile = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".go"))
        .map((entry) => entry.name)
        .sort()[0];
      if (!firstGoFile) return { specifier, status: "external" };
      return {
        specifier,
        status: "internal",
        path: `${relDir.length === 0 ? firstGoFile : `${relDir}/${firstGoFile}`}`,
      };
    } catch {
      return { specifier, status: "external" };
    }
  }

  return { resolve };
}
