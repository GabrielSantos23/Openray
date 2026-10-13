// Notes markdown conversion (docs/notes-spec.md, "Markdown flavor (confirmed)").
//
// The clone stores notes as markdown text in a plain editor, so `Copy Note As… → HTML` and the
// HTML export need a converter for exactly the confirmed node set — marks bold/italic/strike/
// underline/code/link, nodes paragraph/heading 1–6/blockquote/codeBlock/horizontalRule/
// bullet list/ordered list (with start)/task list/hardBreak. `toPlainText` backs the Plain Text
// copy/export by stripping the same markup.

"use strict";

function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Inline markup, code spans first so their content is never further transformed. */
function renderInline(text) {
  const parts = String(text).split(/(`[^`]+`)/);
  let out = "";
  for (const part of parts) {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      out += `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      continue;
    }
    let chunk = escapeHtml(part);
    // Underline arrives as a literal <u> tag (Tiptap's underline mark); re-admit that one tag.
    chunk = chunk.replace(/&lt;(\/?)u&gt;/g, "<$1u>");
    chunk = chunk.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label, url) => `<a href="${url}">${label}</a>`);
    chunk = chunk.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    chunk = chunk.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    chunk = chunk.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    chunk = chunk.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1<em>$2</em>");
    chunk = chunk.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1<em>$2</em>");
    out += chunk;
  }
  return out;
}

const FENCE = /^```(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const QUOTE = /^ {0,3}>\s?(.*)$/;
const TASK = /^ {0,3}[-*]\s+\[([ xX])\]\s+(.*)$/;
const BULLET = /^ {0,3}[-*]\s+(.*)$/;
const ORDERED = /^ {0,3}(\d+)[.)]\s+(.*)$/;

function renderListItems(lines, kind) {
  const [open, close] =
    kind === "task"
      ? ['<ul data-type="taskList">', "</ul>"]
      : kind === "ordered"
        ? ["<ol>", "</ol>"]
        : ["<ul>", "</ul>"];
  const items = lines.map((line) => {
    if (kind === "task") {
      const match = TASK.exec(line);
      if (match) {
        const checked = match[1].toLowerCase() === "x" ? "true" : "false";
        return `<li data-checked="${checked}"><p>${renderInline(match[2])}</p></li>`;
      }
      return `<li><p>${renderInline(BULLET.exec(line)?.[1] ?? line)}</p></li>`;
    }
    if (kind === "ordered") {
      const match = ORDERED.exec(line);
      return `<li><p>${renderInline(match?.[2] ?? line)}</p></li>`;
    }
    const match = BULLET.exec(line);
    return `<li><p>${renderInline(match?.[1] ?? line)}</p></li>`;
  });
  return `${open}${items.join("")}${close}`;
}

/** Lines → block HTML for the confirmed node set. Blank lines separate paragraphs. */
function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      index += 1;
      const code = [];
      while (index < lines.length && !FENCE.exec(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1; // the closing fence (or end of input)
      const language = fence[1] ? ` class="language-${fence[1]}"` : "";
      out.push(`<pre><code${language}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    if (HR.exec(line)) {
      out.push("<hr>");
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (QUOTE.exec(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.exec(lines[index])) {
        quoted.push(QUOTE.exec(lines[index])[1]);
        index += 1;
      }
      out.push(`<blockquote><p>${quoted.map(renderInline).join("<br>")}</p></blockquote>`);
      continue;
    }

    const task = TASK.exec(line);
    if (task) {
      const items = [];
      while (index < lines.length && TASK.exec(lines[index])) {
        items.push(lines[index]);
        index += 1;
      }
      out.push(renderListItems(items, "task"));
      continue;
    }

    if (BULLET.exec(line)) {
      const items = [];
      while (index < lines.length && (BULLET.exec(lines[index]) && !TASK.exec(lines[index]))) {
        items.push(lines[index]);
        index += 1;
      }
      out.push(renderListItems(items, "bullet"));
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      const items = [];
      while (index < lines.length && ORDERED.exec(lines[index])) {
        items.push(lines[index]);
        index += 1;
      }
      const list = renderListItems(items, "ordered");
      // The confirmed node carries a start value; the first item's number is the start.
      out.push(list.replace("<ol>", `<ol start="${ordered[1]}">`));
      continue;
    }

    // Paragraph: single newlines are hard breaks (Tiptap's hardBreak node).
    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== "" &&
      !FENCE.exec(lines[index]) &&
      !HEADING.exec(lines[index]) &&
      !HR.exec(lines[index]) &&
      !QUOTE.exec(lines[index]) &&
      !TASK.exec(lines[index]) &&
      !BULLET.exec(lines[index]) &&
      !ORDERED.exec(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    out.push(`<p>${paragraph.map(renderInline).join("<br>")}</p>`);
  }
  return out.join("");
}

function stripInline(text) {
  return String(text)
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\(([^)\s]+)\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/<u>(.*?)<\/u>/g, "$1")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, "$1$2");
}

/** The Plain Text copy/export: markup removed, structure kept readable. */
function toPlainText(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out = [];
  let inFence = false;
  for (const line of lines) {
    const fence = FENCE.exec(line);
    if (fence) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (line.trim() === "") {
      out.push("");
      continue;
    }
    if (HR.exec(line)) {
      out.push("");
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      out.push(stripInline(heading[2]));
      continue;
    }
    const quote = QUOTE.exec(line);
    if (quote) {
      out.push(stripInline(quote[1]));
      continue;
    }
    const task = TASK.exec(line);
    if (task) {
      out.push(`- [${task[1].toLowerCase() === "x" ? "x" : " "}] ${stripInline(task[2])}`);
      continue;
    }
    const ordered = ORDERED.exec(line);
    if (ordered) {
      out.push(`${ordered[1]}. ${stripInline(ordered[2])}`);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      out.push(`- ${stripInline(bullet[1])}`);
      continue;
    }
    out.push(stripInline(line));
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** The derived title: first non-empty line, else `Untitled` (confirmed editor behavior). */
function deriveTitle(text) {
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.replace(/^#{1,6}\s+/, "");
  }
  return "Untitled";
}

// ---- HTML → markdown (the rich editor serializes back through here) -------------------------
//
// Runs in Node (backend handler + tests), so it parses the well-formed, machine-generated HTML
// with a small tokenizer instead of a DOM. Covers exactly the node subset markdownToHtml emits.

function parseHtmlTree(html) {
  const root = { tag: "#root", attrs: {}, children: [] };
  const stack = [root];
  const pattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const [full, tagName, attrs, text] = match;
    if (text !== undefined) {
      stack[stack.length - 1].children.push({ tag: "#text", text, children: [] });
      continue;
    }
    const tag = tagName.toLowerCase();
    const attributes = {};
    for (const attr of String(attrs ?? "").matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
      attributes[attr[1]] = attr[2];
    }
    if (full.startsWith("</")) {
      for (let index = stack.length - 1; index > 0; index--) {
        if (stack[index].tag === tag) {
          stack.length = index;
          break;
        }
      }
      continue;
    }
    const node = { tag, attrs: attributes, children: [] };
    stack[stack.length - 1].children.push(node);
    // br/hr are void; nothing else in the subset is.
    if (tag !== "br" && tag !== "hr") stack.push(node);
  }
  return root;
}

function serializeInlineNodes(children) {
  let out = "";
  for (const child of children) {
    if (child.tag === "#text") {
      out += child.text;
      continue;
    }
    const inner = serializeInlineNodes(child.children);
    switch (child.tag) {
      case "strong":
      case "b":
        out += `**${inner}**`;
        break;
      case "em":
      case "i":
        out += `*${inner}*`;
        break;
      case "s":
      case "del":
        out += `~~${inner}~~`;
        break;
      case "u":
        out += `<u>${inner}</u>`;
        break;
      case "code":
        out += `\`${inner}\``;
        break;
      case "a":
        out += `[${inner}](${child.attrs.href ?? ""})`;
        break;
      case "br":
        out += "\n";
        break;
      default:
        out += inner;
    }
  }
  return out;
}

/** Inverse of the confirmed subset: the HTML the rich editor produces → markdown text. */
function htmlToMarkdown(html) {
  const root = parseHtmlTree(String(html ?? ""));
  const blocks = [];
  for (const child of root.children) {
    switch (child.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(child.tag[1]);
        blocks.push(`${"#".repeat(level)} ${serializeInlineNodes(child.children).trim()}`);
        break;
      }
      case "p":
        blocks.push(serializeInlineNodes(child.children).trim());
        break;
      case "blockquote":
        for (const line of serializeInlineNodes(child.children).split("\n")) {
          blocks.push(`> ${line.trim()}`);
        }
        break;
      case "pre": {
        const code = child.children.find((node) => node.tag === "code") ?? child;
        const language = code.attrs.class?.match(/language-(\S+)/)?.[1] ?? "";
        const text = flattenText(code).replace(/\n$/, "");
        blocks.push(`\`\`\`${language}\n${text}\n\`\`\``);
        break;
      }
      case "hr":
        blocks.push("---");
        break;
      case "ul":
      case "ol": {
        const ordered = child.tag === "ol";
        const start = ordered ? Number(child.attrs.start ?? 1) : 0;
        const task = child.attrs["data-type"] === "taskList";
        const lines = child.children.map((li, index) => {
          const body = serializeInlineNodes(li.children).trim();
          const marker = ordered ? `${start + index}.` : "-";
          const checked = task ? (li.attrs["data-checked"] === "true" ? "[x]" : "[ ]") : null;
          return checked ? `${marker} ${checked} ${body}` : `${marker} ${body}`;
        });
        blocks.push(lines.join("\n"));
        break;
      }
      case "#text":
        if (child.text.trim()) blocks.push(child.text.trim());
        break;
      default: {
        const text = serializeInlineNodes(child.children).trim();
        if (text) blocks.push(text);
      }
    }
  }
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n");
}

function flattenText(node) {
  if (node.tag === "#text") return node.text;
  return node.children.map(flattenText).join("");
}

module.exports = { markdownToHtml, toPlainText, deriveTitle, htmlToMarkdown };
