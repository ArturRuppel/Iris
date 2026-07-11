/* The gallery markdown carries a few custom URL schemes that react-markdown hands
   to our img/a overrides:
     ![](example:<caseId>/<analysisId>)   -> inline plot SVG
     [Open in Iris](iris-open:<caseId>)   -> Open-in-session action
     [Start](iris-tutorial:<id>)          -> launch the interactive tutorial
   These pure parsers keep the resolution logic DOM-free and testable. */

export interface ExampleRef { caseId: string; analysisId: string; }
export interface OpenRef { caseId: string; }
export interface TutorialRef { tutorialId: string; }

export function parseExampleToken(src: string | undefined): ExampleRef | null {
  if (!src || !src.startsWith("example:")) return null;
  const rest = src.slice("example:".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { caseId: rest.slice(0, slash), analysisId: rest.slice(slash + 1) };
}

export function parseOpenToken(href: string | undefined): OpenRef | null {
  if (!href || !href.startsWith("iris-open:")) return null;
  const caseId = href.slice("iris-open:".length);
  return caseId ? { caseId } : null;
}

export function parseTutorialToken(href: string | undefined): TutorialRef | null {
  if (!href || !href.startsWith("iris-tutorial:")) return null;
  const tutorialId = href.slice("iris-tutorial:".length);
  return tutorialId ? { tutorialId } : null;
}
