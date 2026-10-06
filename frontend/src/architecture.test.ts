import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it } from "vitest";

const files = ["views", "components"].flatMap(directory => {
  const base = new URL("./" + directory + "/", import.meta.url);
  return readdirSync(base, { recursive: true }).filter(file => String(file).endsWith(".tsx"))
    .map(file => new URL(String(file), base));
});

function visit(node: ts.Node, check: (node: ts.Node) => void) {
  check(node);
  ts.forEachChild(node, child => visit(child, check));
}

function unwrap(node: ts.Expression): ts.Expression {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}

it("keeps every application view and shared control below its own Root-dependent Scope", () => {
  const violations: string[] = [];
  for (const file of files) {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(source, node => {
      if (!ts.isFunctionDeclaration(node) || !node.name || !/^[A-Z]/.test(node.name.text) || !node.body) return;
      const returned = node.body.statements.find(ts.isReturnStatement)?.expression;
      const jsx = returned && unwrap(returned);
      const tag = jsx && ts.isJsxElement(jsx) ? jsx.openingElement.tagName.getText(source) : "";
      if (tag !== "Scope" && tag !== "viewHierarchy.Scope") violations.push(file.pathname + ":" + node.name.text);
    });
  }
  expect(violations).toEqual([]);
});

it("keeps state, effects and behavioral decisions out of Passive View notifications", () => {
  const violations: string[] = [];
  for (const file of files.filter(file => file.pathname.includes("/views/"))) {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const report = (node: ts.Node, reason: string) => violations.push(file.pathname + ":" + source.getLineAndCharacterOfPosition(node.getStart()).line + " " + reason);
    visit(source, node => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const module = node.moduleSpecifier.text;
        const childView = module.startsWith(".") && new URL(module, file).pathname.startsWith(new URL("./views/", import.meta.url).pathname);
        const renderingImport = childView || module === "react" || module === "lucide-react" || module.includes("/components/") || module.endsWith("/events/hierarchy");
        const parametersImport = module.includes("/presenters/") && node.importClause?.isTypeOnly;
        if (!renderingImport && !parametersImport) report(node, "View imports a behavior-owning layer");
        if (module === "react" && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
          for (const binding of node.importClause.namedBindings.elements) {
            if (!["useRef", "useEffect", "useMemo", "useCallback", "useId", "memo", "Ref"].includes(binding.name.text)) report(binding, "View imports a state hook");
          }
        }
      }
      if (ts.isIdentifier(node) && ["fetch", "document", "localStorage", "setTimeout", "setInterval"].includes(node.text)) report(node, "View performs an external effect");
      if (ts.isJsxAttribute(node) && node.name.getText(source) === "handle") report(node, "View intercepts an event instead of delegating to the Mediator");
      if (ts.isJsxAttribute(node) && (/^on[A-Z]/.test(node.name.getText(source)) || ["change", "keypress"].includes(node.name.getText(source)))) {
        visit(node, descendant => {
          if (ts.isIfStatement(descendant) || ts.isSwitchStatement(descendant) || ts.isConditionalExpression(descendant)) report(descendant, "View decides behavior inside a notification");
          if (ts.isCallExpression(descendant) && descendant.expression.getText(source) !== "emit") report(descendant, "View calls behavior inside a notification");
        });
      }
    });
  }
  expect(violations).toEqual([]);
});
