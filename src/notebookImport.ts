import { planetColorForSeed, planetTextureForSeed } from "./config/planetTheme";
import type { AtlasNode } from "./types";

export type NotebookImportFormat = "markdown" | "opml" | "freemind";

export interface ExternalNotebookImportResult {
  root: AtlasNode;
  datasetName: string;
  format: NotebookImportFormat;
}

export interface MarkdownImportResult {
  root: AtlasNode;
  datasetName: string;
  format: "markdown";
}

interface ImportNodeDraft {
  title: string;
  body: string;
  children: ImportNodeDraft[];
}

interface StackItem {
  level: number;
  node: ImportNodeDraft;
}

const IMPORTED_TAG = "imported";

export async function importExternalNotebookFile(file: File): Promise<ExternalNotebookImportResult> {
  const format = detectImportFormat(file.name);
  if (!format) {
    throw new Error("Unsupported import file. Use Markdown, OPML, FreeMind .mm, .mindatlas, or .mindatlaspkg.");
  }
  const text = await file.text();
  const datasetName = datasetNameFromFile(file.name);
  const draft =
    format === "markdown"
      ? parseMarkdownNotebook(text, datasetName)
      : format === "opml"
        ? parseOpmlNotebook(text, datasetName)
        : parseFreeMindNotebook(text, datasetName);
  return { root: createAtlasTree(draft, format), datasetName: draft.title || datasetName, format };
}

export function importMarkdownText(text: string, title = "Imported outline"): MarkdownImportResult {
  const draft = parseMarkdownNotebook(text, title);
  return { root: createAtlasTree(draft, "markdown"), datasetName: draft.title || title, format: "markdown" };
}

export function detectImportFormat(fileName: string): NotebookImportFormat | null {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".md") || lowerName.endsWith(".markdown")) return "markdown";
  if (lowerName.endsWith(".opml")) return "opml";
  if (lowerName.endsWith(".mm")) return "freemind";
  return null;
}

function parseMarkdownNotebook(text: string, fallbackTitle: string): ImportNodeDraft {
  const root = draftNode(fallbackTitle);
  const stack: StackItem[] = [{ level: 0, node: root }];
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let currentNode = root;
  let sawStructuralNode = false;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const title = cleanMarkdownText(heading[2]);
      currentNode = appendStackNode(stack, heading[1].length, title);
      sawStructuralNode = true;
      continue;
    }

    const listItem = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      const level = 7 + Math.floor(listItem[1].replace(/\t/g, "  ").length / 2);
      currentNode = appendStackNode(stack, level, cleanMarkdownText(listItem[2]));
      sawStructuralNode = true;
      continue;
    }

    const bodyLine = line.trimEnd();
    if (!bodyLine.trim()) {
      appendBodyLine(currentNode, "");
      continue;
    }
    appendBodyLine(currentNode, bodyLine);
  }

  trimDraft(root);
  if (!sawStructuralNode && root.body.trim()) {
    root.children.push(draftNode(firstContentLine(root.body) || fallbackTitle, root.body));
    root.body = "";
  }
  if (root.children.length === 1 && !root.body.trim() && root.children[0].children.length > 0) {
    const onlyChild = root.children[0];
    return { ...onlyChild, body: onlyChild.body.trim() };
  }
  if (!root.children.length && !root.body.trim()) throw new Error("Markdown import failed because the file is empty.");
  return root;
}

function parseOpmlNotebook(text: string, fallbackTitle: string): ImportNodeDraft {
  const xml = parseXml(text, "OPML");
  const outlineElements = [...xml.querySelectorAll("body > outline")];
  if (!outlineElements.length) throw new Error("OPML import failed because no body outline items were found.");
  const title = textContent(xml.querySelector("head > title")) || fallbackTitle;
  return {
    title,
    body: "",
    children: outlineElements.map(parseOpmlOutline),
  };
}

function parseOpmlOutline(element: Element): ImportNodeDraft {
  const title =
    element.getAttribute("text") ||
    element.getAttribute("title") ||
    element.getAttribute("description") ||
    "Untitled outline";
  const bodyParts = [
    element.getAttribute("_note"),
    element.getAttribute("description"),
    element.getAttribute("htmlUrl") ? `HTML: ${element.getAttribute("htmlUrl")}` : "",
    element.getAttribute("xmlUrl") ? `XML: ${element.getAttribute("xmlUrl")}` : "",
  ].filter((part): part is string => Boolean(part?.trim() && part !== title));
  return {
    title: title.trim(),
    body: bodyParts.join("\n"),
    children: childElements(element, "outline").map(parseOpmlOutline),
  };
}

function parseFreeMindNotebook(text: string, fallbackTitle: string): ImportNodeDraft {
  const xml = parseXml(text, "FreeMind");
  const rootElement = xml.querySelector("map > node") ?? xml.querySelector("node");
  if (!rootElement) throw new Error("FreeMind import failed because no root node was found.");
  const root = parseFreeMindNode(rootElement);
  return root.title ? root : { ...root, title: fallbackTitle };
}

function parseFreeMindNode(element: Element): ImportNodeDraft {
  const title = element.getAttribute("TEXT") || element.getAttribute("text") || "Untitled node";
  const richNotes = childElements(element, "richcontent")
    .filter((child) => (child.getAttribute("TYPE") || child.getAttribute("type") || "").toUpperCase() === "NOTE")
    .map((child) => cleanXmlText(child.textContent ?? ""));
  const link = element.getAttribute("LINK") || element.getAttribute("link");
  const bodyParts = [...richNotes, link ? `Link: ${link}` : ""].filter(Boolean);
  return {
    title: cleanXmlText(title),
    body: bodyParts.join("\n"),
    children: childElements(element, "node").map(parseFreeMindNode),
  };
}

function createAtlasTree(draft: ImportNodeDraft, format: NotebookImportFormat): AtlasNode {
  const now = new Date().toISOString();
  const usedIds = new Set<string>();
  const build = (node: ImportNodeDraft, parentId: string | undefined, index: number, depth: number): AtlasNode => {
    const title = singleLine(node.title) || "Untitled";
    const body = node.body.trim();
    const seed = `${format}-${parentId ?? "root"}-${index}-${title}`;
    const id = uniqueNodeId(format, title, usedIds);
    return {
      id,
      kind: depth === 0 ? "root" : "thread",
      nodeType: "note",
      title,
      subtitle: depth === 0 ? `${formatLabel(format)} import` : "imported note",
      body,
      author: "human",
      status: "waiting",
      color: planetColorForSeed(seed),
      texture: planetTextureForSeed(seed),
      radius: 28,
      summary: firstContentLine(body) || title,
      nextDecision: "Review this imported outline and edit it as needed.",
      tags: [IMPORTED_TAG, format],
      attachments: [],
      createdAt: now,
      updatedAt: now,
      ...(parentId ? { sourceParentId: parentId } : {}),
      children: node.children.map((child, childIndex) => build(child, id, childIndex, depth + 1)),
    };
  };
  return build(draft, undefined, 0, 0);
}

function appendStackNode(stack: StackItem[], level: number, title: string) {
  while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
  const parent = stack[stack.length - 1].node;
  const node = draftNode(title);
  parent.children.push(node);
  stack.push({ level, node });
  return node;
}

function draftNode(title: string, body = ""): ImportNodeDraft {
  return { title: singleLine(title) || "Untitled", body, children: [] };
}

function appendBodyLine(node: ImportNodeDraft, line: string) {
  node.body = node.body ? `${node.body}\n${line}` : line;
}

function trimDraft(node: ImportNodeDraft) {
  node.title = singleLine(node.title) || "Untitled";
  node.body = node.body.trim();
  node.children.forEach(trimDraft);
}

function parseXml(text: string, label: string) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(text, "application/xml");
  const parserError = xml.querySelector("parsererror");
  if (parserError) {
    throw new Error(`${label} import failed because the XML is invalid.`);
  }
  return xml;
}

function childElements(element: Element, tagName: string) {
  return [...element.children].filter((child) => child.tagName.toLowerCase() === tagName.toLowerCase());
}

function textContent(element: Element | null) {
  return cleanXmlText(element?.textContent ?? "");
}

function cleanXmlText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function cleanMarkdownText(value: string) {
  return value
    .replace(/^\[(.+?)\]\(.+?\)$/, "$1")
    .replace(/[*_`~]+/g, "")
    .trim();
}

function firstContentLine(value: string) {
  return value.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
}

function singleLine(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueNodeId(format: NotebookImportFormat, title: string, usedIds: Set<string>) {
  const base = `import-${format}-${slugify(title) || "node"}`.slice(0, 96);
  let candidate = base;
  let counter = 2;
  while (usedIds.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "Imported outline";
}

function formatLabel(format: NotebookImportFormat) {
  if (format === "opml") return "OPML";
  if (format === "freemind") return "FreeMind";
  return "Markdown";
}
