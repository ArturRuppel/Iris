/* A session bound to a lab-book figure (`?labbook=<url of the .iris>`): the page
   edits that one file, and saves go back to the lab book that served it. */

export function labbookTarget(search: string): string | null {
  return new URLSearchParams(search).get("labbook");
}

export function figureApiUrl(fileUrl: string): string {
  const { origin, pathname } = new URL(fileUrl);
  return `${origin}/api/figures${pathname}`;
}

export function fileName(fileUrl: string): string {
  return decodeURIComponent(new URL(fileUrl).pathname.split("/").pop() ?? "");
}

export type FigureSave = { iris_base64: string; svg: string; base_sha256: string; session: string };

/* Returns the saved file's hash, or throws the lab book's reason for refusing. */
export async function putFigure(fileUrl: string, save: FigureSave): Promise<string> {
  const res = await fetch(figureApiUrl(fileUrl), {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(save),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `the lab book answered ${res.status}`);
  return body.sha256;
}
