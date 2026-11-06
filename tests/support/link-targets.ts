import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DYNAMIC } from "./route-manifest";

export type LinkTarget = {
  file: string;
  line: number;
  /** Path with `${…}` expressions as {@link DYNAMIC}, without query or hash. */
  target: string;
  /** Written as a base path that callers extend with `/<id>` (entity → path maps). */
  isBase: boolean;
};

/** Directories whose source files contain links; the root files are listed in {@link ROOT_FILES}. */
const SCANNED_DIRS = ["app", "components", "lib"];
const ROOT_FILES = ["proxy.ts", "auth.ts", "auth.config.ts"];
const SOURCE_FILE = /\.(ts|tsx)$/;

/**
 * Names of JSX props and object properties whose string value is a link:
 * `href`, `backHref`, `basePath`, `{ url: "/x" }`, `{ pages: { signIn: "/login" } }`.
 */
const LINK_NAME = /^(href|url|path|pathname|basePath|link|redirectTo|callbackUrl|signIn|\w+Href)$/;
/** Variables holding an entity → path map (`ENTITY_HREF`, `BASE_PATH`, …): each string value is a base path. */
const BASE_MAP_NAME = /(HREF|PATH|BASE)/;
/** Functions whose first argument is a path. */
const PATH_FUNCTIONS = new Set(["redirect", "permanentRedirect", "revalidatePath", "buildHref", "tabHref", "fetch"]);
/** Router methods (`router.push("/x")`) whose first argument is a path. */
const ROUTER_METHODS = new Set(["push", "replace", "prefetch"]);

function sourceFilesBelow(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && SOURCE_FILE.test(entry.name))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Every literal path a link-position expression can evaluate to (both branches of `a ? "/x" : "/y"`). */
function pathsOf(expression: ts.Expression): string[] {
  if (ts.isStringLiteralLike(expression)) return [expression.text];
  if (ts.isTemplateExpression(expression)) {
    const spans = expression.templateSpans.map((span) => DYNAMIC + span.literal.text);
    return [expression.head.text + spans.join("")];
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return pathsOf(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...pathsOf(expression.whenTrue), ...pathsOf(expression.whenFalse)];
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.kind;
    if (operator === ts.SyntaxKind.PlusToken) {
      const right = pathsOf(expression.right);
      return pathsOf(expression.left).flatMap((left) => (right.length ? right : [DYNAMIC]).map((tail) => left + tail));
    }
    const isFallback = operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken;
    if (isFallback) return [...pathsOf(expression.left), ...pathsOf(expression.right)];
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return pathsOf(expression.right);
  }
  return [];
}

/**
 * Cuts the query/hash and a trailing glued `${…}` (a query-string suffix such
 * as `/tickets${qs}`), trims trailing slashes, and turns literal `[param]`
 * segments (as in `revalidatePath("/tickets/[id]")`) into placeholders.
 * Returns null for anything that is not an app-internal path.
 */
export function normalizeTarget(raw: string): string | null {
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  let target = raw.split(/[?#]/)[0];
  if (target.endsWith(DYNAMIC) && !target.endsWith(`/${DYNAMIC}`)) target = target.slice(0, -DYNAMIC.length);
  target = target.replace(/\/+$/, "") || "/";
  return target.replace(/\/\[[^/\]]+\]/g, `/${DYNAMIC}`);
}

function propertyName(node: ts.PropertyAssignment | ts.ShorthandPropertyAssignment): string {
  return ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) ? node.name.text : "";
}

/** Name of the variable an object literal initialises, looking through `as`/`satisfies`. */
function declaredVariable(literal: ts.ObjectLiteralExpression): string {
  let parent = literal.parent;
  while (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) || ts.isParenthesizedExpression(parent)) {
    parent = parent.parent;
  }
  return ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name) ? parent.name.text : "";
}

function calleeIsPathFunction(call: ts.CallExpression): boolean {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return PATH_FUNCTIONS.has(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    const isRouter = ts.isIdentifier(callee.expression) && callee.expression.text === "router";
    return isRouter && ROUTER_METHODS.has(callee.name.text);
  }
  return false;
}

/** The expression that carries a link at `node` (also a returned or arrow-bodied path), and whether it is an entity base path. */
function linkExpression(node: ts.Node): { expression: ts.Expression; isBase: boolean } | undefined {
  if (ts.isJsxAttribute(node) && LINK_NAME.test(node.name.getText()) && node.initializer) {
    const value = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
    return value && { expression: value, isBase: false };
  }
  if (ts.isPropertyAssignment(node)) {
    if (LINK_NAME.test(propertyName(node))) return { expression: node.initializer, isBase: false };
    const baseMap = BASE_MAP_NAME.test(declaredVariable(node.parent));
    return baseMap ? { expression: node.initializer, isBase: true } : undefined;
  }
  if (ts.isCallExpression(node) && calleeIsPathFunction(node) && node.arguments[0]) {
    return { expression: node.arguments[0], isBase: false };
  }
  if (ts.isReturnStatement(node) && node.expression) return { expression: node.expression, isBase: false };
  if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) return { expression: node.body, isBase: false };
  const isUrlConstructor = ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "URL";
  if (isUrlConstructor && node.arguments?.[0]) return { expression: node.arguments[0], isBase: false };
  return undefined;
}

function collectFromFile(repoRoot: string, filePath: string): LinkTarget[] {
  const kind = filePath.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(filePath, readFileSync(filePath, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const file = path.relative(repoRoot, filePath).split(path.sep).join("/");
  const found: LinkTarget[] = [];

  const visit = (node: ts.Node) => {
    const link = linkExpression(node);
    if (link) {
      const line = source.getLineAndCharacterOfPosition(link.expression.getStart(source)).line + 1;
      for (const raw of pathsOf(link.expression)) {
        const target = normalizeTarget(raw);
        if (target) found.push({ file, line, target, isBase: link.isBase });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** Every internal link target written in the app's source (JSX hrefs, nav configs, redirects, router calls, …). */
export function collectLinkTargets(repoRoot: string): LinkTarget[] {
  const files = [
    ...SCANNED_DIRS.flatMap((dir) => sourceFilesBelow(path.join(repoRoot, dir))),
    ...ROOT_FILES.map((file) => path.join(repoRoot, file)),
  ];
  return files.flatMap((file) => collectFromFile(repoRoot, file));
}
