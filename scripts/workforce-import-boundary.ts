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
  const control = path.resolve("src/modules/workforce-control-plane");
  const contracts = path.resolve("src/modules/workforce-contract");
  const poolOptions = path.resolve("src/lib/database-options.ts");
  const adapter = path.resolve(
    "src/modules/workforce-contract/mock-adapter.ts",
  );
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
    if (resolved) {
      const target = path.resolve(resolved.resolvedFileName);
      const inControl = file.startsWith(control + path.sep);
      const inContracts = file.startsWith(contracts + path.sep);
      const inPoolOptions = file === poolOptions;
      // Every source edge is checked by the architecture test. Closing each
      // approved shared subtree also closes a controller -> shared -> customer
      // path without trusting that shared modules will remain pure forever.
      const allowed = inControl
        ? target.startsWith(control + path.sep) ||
          target.startsWith(contracts + path.sep) ||
          target.startsWith(
            path.resolve("src/generated/workforce") + path.sep,
          ) ||
          target === poolOptions
        : inContracts
          ? target.startsWith(contracts + path.sep)
          : false;
      if (
        (inControl || inContracts || inPoolOptions) &&
        target.startsWith(path.resolve("src") + path.sep) &&
        !allowed
      )
        failures.push(
          "Workforce enclave dependency cannot import customer services or credentials",
        );
    }
    if (
      resolved &&
      (path.resolve(resolved.resolvedFileName).startsWith(root + path.sep) ||
        (path
          .resolve(resolved.resolvedFileName)
          .startsWith(control + path.sep) &&
          !file.startsWith(control + path.sep)) ||
        (path.resolve(resolved.resolvedFileName) === adapter &&
          !file.startsWith(control + path.sep)))
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
