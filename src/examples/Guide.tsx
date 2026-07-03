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
     [text](https://…)                   -> external citation, new tab
     [text](#anchor)                     -> in-page jump (rehype-slug ids) */

/* Nested-tree pages (docs/guide/*.md). Glob-import so adding a page needs no
   manual import; keyed by slug (the basename without extension). */
const PAGES = import.meta.glob("../../docs/guide/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const mdForSlug = (slug: string): string | undefined =>
  PAGES[`../../docs/guide/${slug}.md`];

/* The legacy full guide is a page too, but sourced from docs/guide.md. */
const LEGACY_SLUG = "full-guide";

/* Ordered nav. Titles and order are explicit here; a toc.json manifest can
   replace this once the tree grows past a handful of pages. */
const NAV: { slug: string; title: string }[] = [
  { slug: "index", title: "Home" },
  { slug: "quickstart", title: "Quickstart" },
  { slug: "data-in", title: "Get your data in" },
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
              if (!ref) return <img {...props} />;
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
              // relative link to another guide page (./slug.md[#anchor])
              const rel = href?.match(/([\w-]+)\.md(?:#.*)?$/);
              if (rel && (mdForSlug(rel[1]) || rel[1] === LEGACY_SLUG))
                return (
                  <button
                    className="guide-link"
                    type="button"
                    onClick={() => goTo(rel[1])}
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
