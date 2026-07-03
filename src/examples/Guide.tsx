import { useAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { guideAnchorAtom } from "../state";
import legacyGuideMd from "../../docs/guide.md?raw";
import { parseExampleToken, parseOpenToken } from "./tokens";

/* The in-app Guide, mid-restructure into a nested, task-oriented tree under
   docs/guide/. Pages are plain Markdown, rendered with react-markdown; the
   nav below switches between them. The old single-file guide (docs/guide.md)
   is kept reachable as "Full guide" until its content is migrated into pages,
   so its anchors — notably the "Why this test?" deep-link target
   (how-iris-chooses-the-test) — still resolve.

   The markdown carries the same link/image kinds as before, resolved here:
     ![](example:<caseId>/<analysisId>)  -> inline example plot SVG
     ![](/guide/<name>.png)              -> a screenshot served from public/
     [Open in Iris](iris-open:<caseId>)  -> load the example into the session
     [text](./other-page.md)             -> jump to another guide page
     [text](./sub/page.md) / (../page.md)-> jump across subfolders
     [text](https://…)                   -> external citation, new tab
     [text](#anchor)                     -> in-page jump (rehype-slug ids) */

/* Nested-tree pages (docs/guide/**\/*.md). Glob-import so adding a page needs no
   manual import; keyed by slug — the path under docs/guide/ without extension,
   so a subfolder page is "test/choosing", a top-level one just "quickstart". */
const PAGES = import.meta.glob("../../docs/guide/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const mdForSlug = (slug: string): string | undefined =>
  PAGES[`../../docs/guide/${slug}.md`];

/* Resolve a relative markdown link against the page it appears on, yielding a
   slug (path under docs/guide/, no extension). Handles ./ and ../ so pages in
   subfolders (test/choosing.md) can link across the tree. Null for non-.md. */
function resolveGuideSlug(fromSlug: string, href: string): string | null {
  const m = href.match(/^([^#]*\.md)(?:#.*)?$/);
  if (!m) return null;
  const segs = fromSlug.includes("/")
    ? fromSlug.slice(0, fromSlug.lastIndexOf("/")).split("/")
    : [];
  for (const part of m[1].replace(/\.md$/, "").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") segs.pop();
    else segs.push(part);
  }
  return segs.length ? segs.join("/") : null;
}

/* The legacy full guide is a page too, but sourced from docs/guide.md. */
const LEGACY_SLUG = "full-guide";

/* Ordered nav. Titles and order are explicit here; a toc.json manifest can
   replace this once the tree grows past a handful of pages. */
const NAV: { slug: string; title: string }[] = [
  { slug: "index", title: "Home" },
  { slug: "quickstart", title: "Quickstart" },
  { slug: "data-in", title: "Get your data in" },
  { slug: "shape", title: "Shape it" },
  { slug: "reshaping", title: "Reshaping real data" },
  { slug: "plots", title: "Plot types" },
  { slug: "nesting", title: "Nested data" },
  { slug: "test/choosing", title: "Choosing a test" },
  { slug: "test/interpreting", title: "Reading the result" },
  { slug: "troubleshooting", title: "Troubleshooting" },
  { slug: "reference/composition", title: "How the pieces fit" },
  { slug: "reference/iris-format", title: "The .iris file" },
  { slug: "reference/citations", title: "References" },
  { slug: LEGACY_SLUG, title: "Full guide" },
];

/* Bundled, committed example SVGs (the example: token targets). Glob-import so
   adding a case needs no manual import; SVGs come in as raw markup. */
const SVGS = import.meta.glob("./assets/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const svgByAnalysis = (analysisId: string): string | undefined =>
  SVGS[`./assets/${analysisId}.svg`];

export function Guide({ onOpen }: { onOpen: (caseId: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState("index");
  const [anchor, setAnchor] = useAtom(guideAnchorAtom);

  /* A deep-link request from elsewhere (the stats pane's "Why this test?"):
     its target anchors live in the legacy full guide, so switch there first,
     then scroll the named section into view and clear the request. */
  useEffect(() => {
    if (!anchor) return;
    if (page !== LEGACY_SLUG) {
      setPage(LEGACY_SLUG);
      return; // re-runs once the legacy page has rendered
    }
    const el = rootRef.current?.querySelector(`#${CSS.escape(anchor)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setAnchor(null);
  }, [anchor, page, setAnchor]);

  const goTo = (slug: string) => {
    setPage(slug);
    // the scroll container is the .examples-mode ancestor, not the gallery div
    rootRef.current?.closest<HTMLElement>(".examples-mode")?.scrollTo?.({ top: 0 });
  };

  const md = page === LEGACY_SLUG ? legacyGuideMd : mdForSlug(page) ?? "";

  return (
    <div className="gallery guide-doc" ref={rootRef}>
      <nav className="guide-nav">
        {NAV.map((p) => (
          <button
            key={p.slug}
            className={p.slug === page ? "active" : ""}
            type="button"
            onClick={() => goTo(p.slug)}
          >
            {p.title}
          </button>
        ))}
      </nav>
      <div className="gallery-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeSlug]}
          urlTransform={(url) => url}
          components={{
            img(props) {
              const src = typeof props.src === "string" ? props.src : undefined;
              const ref = parseExampleToken(src);
              if (!ref)
                // A screenshot (/guide/*.png). Captures are retina (2×) but span
                // windows of very different widths, so at column width their UI
                // text renders at wildly different sizes. Draw each at its true
                // 1× logical size — half its natural pixels — so the app font is
                // the same size in every shot; wide shots break out of the text
                // column via the .guide-shot CSS below.
                return (
                  <img
                    {...props}
                    className="guide-shot"
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      el.style.width = `${el.naturalWidth / 2}px`;
                    }}
                  />
                );
              const svg = svgByAnalysis(ref.analysisId);
              if (!svg)
                return (
                  <span className="gallery-missing">
                    ⚠ unknown example &quot;{ref.caseId}/{ref.analysisId}&quot;
                  </span>
                );
              return (
                <figure
                  className="gallery-figure"
                  dangerouslySetInnerHTML={{ __html: svg }}
                />
              );
            },
            a(props) {
              const href =
                typeof props.href === "string" ? props.href : undefined;
              const open = parseOpenToken(href);
              if (open)
                return (
                  <button
                    className="gallery-open-btn"
                    type="button"
                    onClick={() => onOpen(open.caseId)}
                  >
                    {props.children}
                  </button>
                );
              if (href && /^https?:\/\//.test(href))
                return <a {...props} target="_blank" rel="noopener noreferrer" />;
              if (href && href.startsWith("#")) return <a {...props} />;
              // relative link to another guide page (./slug.md[#anchor]),
              // resolved against the current page so subfolder links work
              const target = href ? resolveGuideSlug(page, href) : null;
              if (target && (mdForSlug(target) || target === LEGACY_SLUG))
                return (
                  <button
                    className="guide-link"
                    type="button"
                    onClick={() => goTo(target)}
                  >
                    {props.children}
                  </button>
                );
              // an as-yet-unwritten page or other relative path: plain text
              return <>{props.children}</>;
            },
          }}
        >
          {md}
        </ReactMarkdown>
      </div>
    </div>
  );
}
