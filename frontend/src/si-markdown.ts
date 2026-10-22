import { marked, Renderer } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";
import { native } from "./bridge";

/** Service text is data. HTML/images never become application controls. */
export function renderMarkdown(source: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "si-markdown";
  const renderer = new Renderer();
  renderer.html = () => "";
  renderer.image = () => "";
  const equations: string[] = [];
  const markdown = source.replace(
    /(^|\n)\$\$\s*\n?([\s\S]+?)\n?\$\$(?=\n|$)/g,
    (_all, prefix, formula) => {
      if (equations.length >= 64 || formula.length > 2048)
        return `${prefix}\n${formula}\n`;
      const index = equations.push(formula) - 1;
      return `${prefix}\n\nCHRONOSCOPEMATHBLOCK${index}END\n\n`;
    },
  );
  const html = marked.parse(markdown, {
    renderer,
    gfm: true,
    breaks: true,
    async: false,
  }) as string;
  root.innerHTML = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "em",
      "del",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "pre",
      "code",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "a",
      "hr",
    ],
    ALLOWED_ATTR: ["href", "title", "start", "align"],
    ALLOW_DATA_ATTR: false,
  });
  for (const link of root.querySelectorAll("a")) {
    const value = link.getAttribute("href") || "";
    try {
      const url = new URL(value);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw Error();
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      if (native)
        link.onclick = (e) => {
          e.preventDefault();
          void import("@tauri-apps/api/core")
            .then(({ invoke }) => invoke("si_open_link", { url: url.href }))
            .catch(() => {
              link.title = "Could not open this source link";
            });
        };
    } catch {
      link.removeAttribute("href");
    }
  }
  for (const paragraph of root.querySelectorAll("p")) {
    const match = paragraph.textContent?.match(
      /^CHRONOSCOPEMATHBLOCK(\d+)END$/,
    );
    if (match && equations[Number(match[1])] != null) {
      const math = document.createElement("div");
      math.className = "si-equation";
      try {
        katex.render(equations[Number(match[1])], math, {
          displayMode: true,
          throwOnError: false,
          trust: false,
          maxExpand: 100,
          maxSize: 10,
        });
        paragraph.replaceWith(math);
      } catch {
        /* Keep the source text if formatting fails. */
      }
    }
  }
  for (const table of root.querySelectorAll("table")) {
    const scroll = document.createElement("div");
    scroll.className = "si-rich-table";
    table.replaceWith(scroll);
    scroll.append(table);
  }
  return root;
}
