// Markdown renderer for Detail / List.Item.Detail.
//
// Raycast renders markdown through a bundled markdown component (`markdown-BLthXIVh.js`) with a
// custom image loader; headings, lists, tables, code blocks and images are all supported. This is a
// compact dependency-free renderer producing React elements (never `innerHTML`) that covers the same
// surface: headings, paragraphs, inline formatting (bold/italic/code/links), fenced code blocks,
// block quotes, ordered/unordered lists, tables, images and rules.

import { type ReactNode } from "react";

interface Line {
  text: string;
}

function splitRows(markdown: string): Line[] {
  return markdown.replace(/\r\n/g, "\n").split("\n").map((text) => ({ text }));
}

// ------------------------------------------------------------------------------------------
// Inline formatting: `code`, **bold**, *italic*, [text](url) — innermost-last, single pass.
// ------------------------------------------------------------------------------------------

const INLINE_RULES: { pattern: RegExp; render: (match: RegExpExecArray, key: string) => ReactNode }[] = [
  {
    pattern: /`([^`]+)`/,
    render: (match, key) => <code key={key}>{match[1]}</code>,
  },
  {
    pattern: /\*\*([^*]+)\*\*/,
    render: (match, key) => <strong key={key}>{match[1]}</strong>,
  },
  {
    pattern: /\*([^*]+)\*/,
    render: (match, key) => <em key={key}>{match[1]}</em>,
  },
  {
    pattern: /\[([^\]]+)\]\(([^)\s]+)\)/,
    render: (match, key) => (
      <a key={key} href={match[2]} target="_blank" rel="noreferrer">
        {match[1]}
      </a>
    ),
  },
];

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let rest = text;
  let key = 0;
  while (rest.length > 0) {
    let best: { index: number; match: RegExpExecArray; render: (m: RegExpExecArray, k: string) => ReactNode } | null = null;
    for (const rule of INLINE_RULES) {
      const match = rule.pattern.exec(rest);
      if (match && (best === null || match.index < best.index)) {
        best = { index: match.index, match, render: rule.render };
      }
    }
    if (!best) {
      nodes.push(rest);
      break;
    }
    if (best.index > 0) nodes.push(rest.slice(0, best.index));
    nodes.push(best.render(best.match, `i${key++}`));
    rest = rest.slice(best.index + best.match[0].length);
  }
  return nodes;
}

function stripLinkTarget(text: string): string {
  return text.replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
}

// ------------------------------------------------------------------------------------------
// Block parsing
// ------------------------------------------------------------------------------------------

export function renderMarkdown(markdown: string): ReactNode[] {
  const lines = splitRows(markdown);
  const nodes: ReactNode[] = [];
  let index = 0;
  let key = 0;

  const push = (node: ReactNode) => nodes.push(<div key={`b${key++}`}>{node}</div>);

  while (index < lines.length) {
    const line = lines[index].text;

    if (line.trim() === "") {
      index += 1;
      continue;
    }

    // Fenced code block
    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].text.trim().startsWith("```")) {
        code.push(lines[index].text);
        index += 1;
      }
      index += 1; // closing fence
      push(
        <pre className="markdown__code" data-language={fence[1] || undefined}>
          <code>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Headings
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const className = `markdown__h${level}`;
      const content = renderInline(heading[2]);
      if (level === 1) push(<h1 className={className}>{content}</h1>);
      else if (level === 2) push(<h2 className={className}>{content}</h2>);
      else if (level === 3) push(<h3 className={className}>{content}</h3>);
      else push(<h4 className={className}>{content}</h4>);
      index += 1;
      continue;
    }

    // Horizontal rule
    if (/^ {0,3}([-*_])[ \t]*(\1[ \t]*){2,}$/.test(line)) {
      push(<hr className="markdown__hr" />);
      index += 1;
      continue;
    }

    // Image on its own line
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line.trim());
    if (image) {
      push(
        <img className="markdown__image" src={image[2]} alt={image[1]} loading="lazy" />,
      );
      index += 1;
      continue;
    }

    // Block quote
    if (line.trimStart().startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && lines[index].text.trimStart().startsWith(">")) {
        quote.push(lines[index].text.trimStart().replace(/^>\s?/, ""));
        index += 1;
      }
      push(<blockquote className="markdown__quote">{renderMarkdown(quote.join("\n"))}</blockquote>);
      continue;
    }

    // Table: | a | b | then a |---|---| separator
    if (line.trim().startsWith("|") && index + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index + 1].text) && lines[index + 1].text.includes("-")) {
      const header = parseTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && lines[index].text.trim().startsWith("|")) {
        rows.push(parseTableRow(lines[index].text));
        index += 1;
      }
      push(
        <table className="markdown__table">
          <thead>
            <tr>
              {header.map((cell, cellIndex) => (
                <th key={cellIndex}>{renderInline(cell)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>{renderInline(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    // Ordered / unordered lists
    const unordered = /^\s*[-*+]\s+(.*)$/;
    const ordered = /^\s*(\d+)[.)]\s+(.*)$/;
    if (unordered.test(line) || ordered.test(line)) {
      const isOrdered = ordered.test(line);
      const items: { text: string; depth: number }[] = [];
      while (index < lines.length && (unordered.test(lines[index].text) || ordered.test(lines[index].text))) {
        const raw = lines[index].text;
        const body = raw.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
        const depth = Math.min(3, Math.floor((raw.length - raw.trimStart().length) / 2));
        items.push({ text: body, depth });
        index += 1;
      }
      const topDepth = items[0].depth;
      const Item = isOrdered ? "ol" : "ul";
      push(
        <Item className={`markdown__list markdown__list--${isOrdered ? "ordered" : "unordered"}`}>
          {items.map((item, itemIndex) =>
            item.depth === topDepth ? (
              <li key={itemIndex}>
                {renderInline(stripLinkTarget(item.text))}
                {item.depth > topDepth ? null : null}
              </li>
            ) : null,
          )}
        </Item>,
      );
      continue;
    }

    // Paragraph: gather until blank line / block start
    const paragraph: string[] = [];
    while (
      index < lines.length &&
      lines[index].text.trim() !== "" &&
      !/^(#{1,6})\s/.test(lines[index].text) &&
      !lines[index].text.trim().startsWith("```") &&
      !lines[index].text.trimStart().startsWith(">") &&
      !/^\s*[-*+]\s+/.test(lines[index].text) &&
      !/^\s*\d+[.)]\s+/.test(lines[index].text) &&
      !lines[index].text.trim().startsWith("|")
    ) {
      paragraph.push(lines[index].text);
      index += 1;
    }
    if (paragraph.length > 0) {
      push(<p className="markdown__p">{renderInline(paragraph.join(" "))}</p>);
    }
  }
  return nodes;
}

function parseTableRow(row: string): string[] {
  return row
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** `EK` in `main-window-g1Vb1JLY.js`: the first `# ` heading doubles as the navigation title. */
export function markdownTitle(markdown: string): string | null {
  const match = /^\s*#\s+(.+?)(?:\n|$)/.exec(markdown);
  return match ? match[1].trim() : null;
}
