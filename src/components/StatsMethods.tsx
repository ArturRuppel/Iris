import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import methodsMd from "../../docs/stats-recommendations.md?raw";

/* Renders the canonical stats-recommendation rules (docs/stats-recommendations.md)
   inside the app, so the reasoning behind every recommended test — thresholds,
   rationale, sources, failure modes — is reachable from the Methods tab and from
   the "Why this test?" link in the stats pane. The markdown is bundled at build
   time (?raw), the same mechanism the Examples gallery uses for its prose.

   Link handling: external URLs (the citations) open in a new tab; in-page anchors
   keep their default behaviour; relative repo paths (dev-facing file references in
   the doc) render as plain text so nothing looks like a broken link. */
export function StatsMethods() {
  return (
    <div className="gallery methods-doc">
      <div className="gallery-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a(props) {
            const href = typeof props.href === "string" ? props.href : "";
            if (/^https?:\/\//.test(href)) {
              return <a {...props} target="_blank" rel="noopener noreferrer" />;
            }
            if (href.startsWith("#")) return <a {...props} />;
            // relative repo path (e.g. ../src/...): not navigable in-app → plain text
            return <>{props.children}</>;
          },
        }}
      >
        {methodsMd}
      </ReactMarkdown>
      </div>
    </div>
  );
}
