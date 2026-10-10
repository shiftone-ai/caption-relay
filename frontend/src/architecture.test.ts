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

function scopeViolations(source: ts.SourceFile): string[] {
  const violations: string[] = [];
  const definitions = new Map<string, ts.Expression | ts.FunctionDeclaration>();
  visit(source, node => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) definitions.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) definitions.set(node.name.text, node.initializer);
  });
  const resolve = (expression: ts.Expression | ts.FunctionDeclaration, seen = new Set<string>()): ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | null => {
    if (ts.isFunctionDeclaration(expression) || ts.isFunctionExpression(expression) || ts.isArrowFunction(expression)) return expression;
    if (ts.isParenthesizedExpression(expression)) return resolve(expression.expression, seen);
    if (ts.isCallExpression(expression) && /^(?:React\.)?(memo|forwardRef)$/.test(expression.expression.getText(source)) && expression.arguments[0]) return resolve(expression.arguments[0], seen);
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      seen.add(expression.text);
      const target = definitions.get(expression.text);
      if (target) return resolve(target, seen);
    }
    return null;
  };
  for (const [name, definition] of definitions) {
    if (!/^[A-Z]/.test(name)) continue;
    const component = resolve(definition);
    if (!component?.body) continue;
    const returns: ts.Expression[] = [];
    if (!ts.isBlock(component.body)) returns.push(component.body);
    else {
      const collect = (node: ts.Node) => {
        if (ts.isFunctionLike(node)) return;
        if (ts.isReturnStatement(node) && node.expression) returns.push(node.expression);
        ts.forEachChild(node, collect);
      };
      collect(component.body);
    }
    if (!returns.length || returns.some(returned => {
      const jsx = unwrap(returned);
      const tag = ts.isJsxElement(jsx) ? jsx.openingElement.tagName.getText(source)
        : ts.isJsxSelfClosingElement(jsx) ? jsx.tagName.getText(source) : "";
      return tag !== "Scope" && tag !== "viewHierarchy.Scope";
    })) violations.push(name);
  }
  return violations;
}

function passiveViolations(source: ts.SourceFile, file: URL): string[] {
  const violations: string[] = [];
  const isControl = file.pathname.includes("/components/");
  const report = (node: ts.Node, reason: string) => violations.push(source.getLineAndCharacterOfPosition(node.getStart()).line + " " + reason);
  visit(source, node => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const module = node.moduleSpecifier.text;
      const resolved = module.startsWith(".") ? new URL(module, file).pathname : "";
      const renderingImport = ["views", "components"].some(directory => resolved.startsWith(new URL("./" + directory + "/", import.meta.url).pathname))
        || ["react", "lucide-react", "class-variance-authority", "radix-ui", "cn", "@/lib/utils"].includes(module) || module.endsWith("/events/hierarchy");
      const parametersImport = (module.includes("/presenters/") || module.endsWith("/domain")) && node.importClause?.isTypeOnly;
      if (!renderingImport && !parametersImport) report(node, "Passive View imports a behavior-owning layer");
      if (module === "react" && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const binding of node.importClause.namedBindings.elements) {
          if (!binding.isTypeOnly && !node.importClause.isTypeOnly && !["useRef", "useEffect", "useMemo", "useCallback", "useId", "memo"].includes(binding.propertyName?.text ?? binding.name.text)) report(binding, "Passive View imports a state hook");
        }
      }
    }
    if (ts.isIdentifier(node) && ["fetch", "document", "localStorage", "setTimeout", "setInterval", "useState", "useReducer", "useSyncExternalStore"].includes(node.text)) report(node, "Passive View owns state or an external effect");
    if (ts.isCallExpression(node) && /^(?:React\.)?useRef$/.test(node.expression.getText(source))) {
      const type = node.typeArguments?.[0]?.getText(source) ?? "";
      const drawingRef = /\b(?:HTML\w*Element|SVG\w*Element|Element|DOMRect)\b/.test(type) || type.includes("typeof viewHierarchy.useBubble");
      if (!drawingRef || node.arguments[0]?.kind !== ts.SyntaxKind.NullKeyword) report(node, "Passive View keeps non-DOM state in a ref");
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "details") {
      if (!file.pathname.endsWith("/components/ui/disclosure.tsx")) report(node, "Disclosure bypasses its controlled event boundary");
      const open = node.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "open");
      if (!open || !ts.isJsxAttribute(open) || !open.initializer || !ts.isJsxExpression(open.initializer) || open.initializer.expression?.getText(source) !== "parameters.open") report(node, "Disclosure open state is not a drawing parameter");
    }
    if (ts.isJsxAttribute(node) && node.name.getText(source) === "handle") report(node, "Passive View intercepts an event instead of delegating to the Mediator");
    if (ts.isJsxAttribute(node) && (/^on[A-Z]/.test(node.name.getText(source)) || ["change", "keypress"].includes(node.name.getText(source)))) {
      visit(node, callback => {
        if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return;
        visit(callback.body, descendant => {
          // A control may suppress the native default after a handled key notification.
          const cancelHandledKey = isControl && file.pathname.endsWith("/textarea.tsx") && ts.isIfStatement(descendant) && descendant.expression.getText(source) === "handled";
          if ((ts.isIfStatement(descendant) && !cancelHandledKey) || ts.isSwitchStatement(descendant) || ts.isConditionalExpression(descendant)) report(descendant, "Passive View decides behavior inside a notification");
          if (ts.isCallExpression(descendant)) {
            const call = descendant.expression.getText(source);
            const domTranslation = isControl && (["change", "keypress"].includes(call) || call === "event.preventDefault");
            if (call !== "emit" && !domTranslation) report(descendant, "Passive View calls behavior inside a notification");
          }
        });
      });
    }
  });
  return violations;
}

it("keeps every application view and shared control below its own Root-dependent Scope", () => {
  const violations = files.flatMap(file => {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return scopeViolations(source).map(reason => file.pathname + ":" + reason);
  });
  expect(violations).toEqual([]);
});

it("detects unscoped arrows, memo wrappers and alternate return paths", () => {
  const source = ts.createSourceFile("fixture.tsx", `
    const Arrow = () => <div />;
    const Wrapped = memo(() => <span />);
    function Conditional({ hidden }) { if (hidden) return <span />; return <Scope name="valid"><div /></Scope>; }
    const Good = memo(() => <Scope name="valid"><span /></Scope>);
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  expect(scopeViolations(source)).toEqual(["Arrow", "Wrapped", "Conditional"]);
});

it("keeps state, effects and behavioral decisions out of all Passive Views and shared controls", () => {
  const violations = files.flatMap(file => {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    return passiveViolations(source, file).map(reason => file.pathname + ":" + reason);
  });
  expect(violations).toEqual([]);
});

it("detects native local state and behavior hidden in a shared control", () => {
  const file = new URL("./components/ui/fixture.tsx", import.meta.url);
  const source = ts.createSourceFile(file.pathname, `
    import * as React from "react";
    import { operatorMachine } from "../../machines/operator";
    const Control = () => { const previous = React.useRef<"display" | null>(null); const [open] = React.useState(false);
      return <Scope name="bad"><details open={open}><summary onClick={() => save()}>説明</summary></details></Scope>; };
  `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = passiveViolations(source, file);
  expect(violations.some(reason => reason.includes("behavior-owning layer"))).toBe(true);
  expect(violations.some(reason => reason.includes("non-DOM state"))).toBe(true);
  expect(violations.some(reason => reason.includes("owns state"))).toBe(true);
  expect(violations.some(reason => reason.includes("controlled event boundary"))).toBe(true);
  expect(violations.some(reason => reason.includes("calls behavior"))).toBe(true);
});

it("reserves focus space in every scrolling panel that contains form controls", () => {
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  const scrolling = new Set(rules.filter(rule => /overflow(?:-y)?\s*:\s*(auto|scroll)/.test(rule[2]))
    .flatMap(rule => [...rule[1].matchAll(/\.([\w-]+)/g)].map(match => match[1])));
  const violations: string[] = [];
  for (const file of files.filter(file => file.pathname.includes("/views/operator/"))) {
    const source = ts.createSourceFile(file.pathname, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    visit(source, node => {
      if (!ts.isJsxElement(node) || !["div", "fieldset"].includes(node.openingElement.tagName.getText(source))) return;
      const attribute = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "className");
      if (!attribute || !ts.isJsxAttribute(attribute) || !attribute.initializer || !ts.isStringLiteral(attribute.initializer)) return;
      const classes = attribute.initializer.text.split(/\s+/);
      if (!classes.some(name => scrolling.has(name))) return;
      let hasControl = false;
      visit(node, child => {
        if ((ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) &&
          ["input", "select", "textarea", "Textarea", "DisplayFieldView"].includes(child.tagName.getText(source))) hasControl = true;
      });
      if (hasControl && !classes.includes("operator-panel-scroll")) violations.push(file.pathname + ":" + classes.join(" "));
    });
  }
  expect(violations).toEqual([]);
  const clearance = rules.find(rule => rule[1].trim() === ".operator-panel-scroll")?.[2];
  expect(clearance).toMatch(/padding:\s*var\(--space\)/);
  expect(clearance).toMatch(/scroll-padding-block:\s*var\(--space\)/);
});
