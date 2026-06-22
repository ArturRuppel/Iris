import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import galleryMd from "./gallery.md?raw";
import { parseExampleToken, parseOpenToken } from "./tokens";

/* Bundled, committed assets. Glob-import so adding a case needs no manual import
   list. SVGs come in as raw markup for crisp inline rendering. */
const SVGS = import.meta.glob("./assets/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const svgByAnalysis = (analysisId: string): string | undefined =>
  SVGS[`./assets/${analysisId}.svg`];

export function ExamplesGallery({
  onOpen,
}: {
  onOpen: (caseId: string) => void;
}) {
  return (
    <div className="gallery">
      <div className="gallery-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          urlTransform={(url) => url}
          components={{
            img(props) {
              const src =
                typeof props.src === "string" ? props.src : undefined;
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
              const ref = parseOpenToken(href);
              if (!ref) return <a {...props} />;
              return (
                <button
                  className="gallery-open-btn"
                  type="button"
                  onClick={() => onOpen(ref.caseId)}
                >
                  {props.children}
                </button>
              );
            },
          }}
        >
          {galleryMd}
        </ReactMarkdown>
      </div>
    </div>
  );
}
