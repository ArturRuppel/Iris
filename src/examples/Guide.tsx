import { useAtom } from "jotai";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";
import { guideAnchorAtom } from "../state";
import guideMd from "../../docs/guide.md?raw";
import { parseExampleToken, parseOpenToken } from "./tokens";

/* The single in-app Guide: plot types, data types, the test-recommendation
   rules (with sources + bibliography), and experimental design / nesting — one
   document over a shared pool of live examples. It folds together what used to
   be the Examples gallery and the stats Methods doc.

   The markdown carries four kinds of link/image, resolved here:
     ![](example:<caseId>/<analysisId>)  -> inline plot SVG (gallery assets)
     [Open in Iris](iris-open:<caseId>)  -> load the example into the session
     [text](https://…)                   -> external citation, opens in a new tab
     [text](#anchor)                      -> in-page jump (rehype-slug adds ids)
     [text](relative/path)               -> dev-facing repo path → plain text
   rehype-slug gives every heading an id so both the in-page anchors and the
   "Why this test?" deep-link (guideAnchorAtom) have something to scroll to. */

/* Bundled, committed assets. Glob-import so adding a case needs no manual import
   list. SVGs come in as raw markup for crisp inline rendering. */
const SVGS = import.meta.glob("./assets/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const svgByAnalysis = (analysisId: string): string | undefined =>
  SVGS[`./assets/${analysisId}.svg`];

export function Guide({ onOpen }: { onOpen: (caseId: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  /* a deep-link request from elsewhere (the stats pane's "Why this test?"):
     scroll the named section into view once the doc is mounted, then clear it so
     a later visit to the Guide tab doesn't re-jump. */
  const [anchor, setAnchor] = useAtom(guideAnchorAtom);
  useEffect(() => {
    if (!anchor) return;
    const el = rootRef.current?.querySelector(`#${CSS.escape(anchor)}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setAnchor(null);
  }, [anchor, setAnchor]);

  return (
    <div className="gallery guide-doc" ref={rootRef}>
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
              // relative repo path (e.g. the .bib): not navigable in-app → plain text
              return <>{props.children}</>;
            },
          }}
        >
          {guideMd}
        </ReactMarkdown>
      </div>
    </div>
  );
}
