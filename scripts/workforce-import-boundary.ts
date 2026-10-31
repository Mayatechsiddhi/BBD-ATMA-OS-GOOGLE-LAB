import path from "node:path";
import ts from "typescript";

// Every src edge is checked, so a barrel/re-export cannot hide a mock import.
// This is a build/test policy, not a sandbox against arbitrary JavaScript.
export function workforceImportViolations(
  file: string,
  source: string,
  options: ts.CompilerOptions,
) {
  const root = path.resolve("src/modules/internal-workforce");
  if (file.startsWith(root + path.sep)) return [];
  const failures: string[] = [];
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const check = (value: ts.Node | undefined) => {
    if (!value || !ts.isStringLiteralLike(value)) {
      failures.push("Nonliteral module loading forbidden in application code");
      return;
    }
    const resolved = ts.resolveModuleName(
      value.text,
      file,
      options,
      ts.sys,
    ).resolvedModule;
    if (
      resolved &&
      path.resolve(resolved.resolvedFileName).startsWith(root + path.sep)
    )
      failures.push("Application cannot import synthetic workforce modules");
  };
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier) check(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      check(node.moduleReference.expression);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) &&
          node.expression.text === "require"))
    ) {
      check(node.arguments[0]);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument)
    ) {
      check(node.argument.literal);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return failures;
}
