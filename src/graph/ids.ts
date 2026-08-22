export const File = {
  prefix: "f:",
  build(path: string): string {
    return `f:${path}`;
  },
};

export function functionId(path: string, name: string): string {
  return `fn:${path}#${name}`;
}

export function classId(path: string, name: string): string {
  return `cls:${path}#${name}`;
}

export function methodId(path: string, className: string, methodName: string): string {
  return `m:${path}#${className}.${methodName}`;
}

export function externalModuleId(specifier: string): string {
  return `xm:${specifier}`;
}

export function externalSymbolId(kind: "function" | "class", owner: string, name: string): string {
  return kind === "class" ? `xc:${owner}#${name}` : `xf:${owner}#${name}`;
}
