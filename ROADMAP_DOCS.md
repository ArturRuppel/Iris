# Iris — Documentation Roadmap

A focused plan for two coupled pieces of work: **restructuring the user
documentation from one flat file into a nested, task-oriented guide**, and
**building a validation harness that keeps the docs' claims from drifting out of
step with the engine**. For the product roadmap see [ROADMAP.md](ROADMAP.md);
this document is the docs-and-validation sub-plan.

The two are one system, not two: the examples embedded in the docs are already
generated from the statistical validation corpus, so "document a thing" and
"validate a thing" share the same artifacts.

## Why now

The in-app guide (`docs/guide.md`, rendered by `src/examples/Guide.tsx`) is
comprehensive but **flat** — one ~900-line scroll with an anchor-link table of
contents. It lacks the two things a task-arriving, non-programmer user needs:

- **overview** — a fast "what is this / where do I go for *my* task";
- **navigability** — you can't find your answer without already knowing the
  conceptual taxonomy.

The fix is a nested guide with **progressive disclosure**: a short overview at
each level, completeness one click down. Nesting is what resolves the
overview-vs-completeness tension — they only conflict in a flat document.

## Guiding principle: docs can't drift

The soul of Iris is "never store what you can recompute; it can't drift." The
docs must earn the same property. A rigor-branded tool whose docs quietly
disagree with its engine is the one hypocrisy we can't ship. Every hard number in
the prose must be tied, by an automated check, to a number the engine actually
produces today.

---

## Target information architecture

Ordered along the user's workflow, which also happens to be the tool's internal
dependency chain (column types gate legal marks gate offered test families).
**Two nav levels, hard cap** (section → page); anything deeper lives as headings
within a page.

```
(landing)         What is Iris — synopsis of the reactive triad + section cards
Quickstart        one worked example end to end (import → shape → plot → test → read)
Get your data in  import (CSV/Excel) · fixing column types · declaring the hierarchy
Shape it          the workbench + the shaping vocabulary (verbs = headings, one page)
Make a plot        gallery-grid overview → one page per mark (~11 leaf pages)
Add a test        ├─ Choosing    (guided picker + the decision axes + small-sample guards)
                  └─ Interpreting (effect sizes, reading the result)
Troubleshooting   the failure-mode catalogue (promoted — it's the most task-oriented content)
Reference         composition rules · glossary (generated) · citations
```

Notes:
- **"What is Iris" is the landing page itself**, not a page you click into.
- **Quickstart is the single highest-value page** — it tells a user whether they
  can do their task, which is what they came to find out. It reuses an existing
  gallery case with an `iris-open:` button up top.
- **Troubleshooting is promoted to top level.** Users arrive from error dialogs
  more than from curiosity; the failure-mode catalogue must not be buried under
  Reference.
- **The 11 marks each get a page** (each has a worked, openable example — a real
  page's worth). **The shaping verbs do not** (each is a paragraph + an example;
  they share one page). Resist symmetry for its own sake.
- **The one genuine content hole is "Get your data in"** — import, typing, and
  declaring the hierarchy are barely documented today, yet they're literally
  step one for a user. This is the biggest pure-writing job and has no dependency
  on any mechanism, so it can be drafted first.

---

## Nesting mechanism

**Decision: many markdown files + a `toc.json` manifest + an in-app sidebar nav.**
The landing page is styled as a card index over the tree. Rejected: accordion
sections in one file (no per-topic overview, nothing for a public static build to
consume, breaks whole-doc expectations — a wall with doors painted on).

```
docs/guide/
  index.md
  quickstart.md
  data-in.md
  shape.md
  plots/index.md  plots/box.md  … (one per mark)
  test/choosing.md  test/interpreting.md
  troubleshooting.md
  reference/{composition.md, glossary.md, citations.md}
  toc.json           # ordered { slug, title, children } tree
```

- **`toc.json`, not filename number-prefixes** — a manifest avoids rename churn
  on every insertion, drives the sidebar, feeds the future static-site config,
  and is itself validated (every toc entry ↔ a file, bijective).
- **Loading**: `import.meta.glob("../../docs/guide/**/*.md", { query: "?raw",
  eager: true })` — the same pattern `Guide.tsx` already uses for SVGs.
- **Cross-page links are plain relative markdown** (`./shape.md#pivot`), *not* a
  custom scheme. The future public static site then resolves them natively with
  zero transformation; only the app pays a custom-render cost — **one added
  branch in the `a()` handler** that resolves a relative `.md` href to nav state
  instead of an `<a>`.
- **The `example:` / `iris-open:` tokens survive unchanged** — they're
  scheme-prefixed and page-agnostic, resolved per render against the SVG glob and
  case pool. Do not "simplify" them to relative asset paths; keeping them as
  schemes is what makes the eventual public-site remark plugin clean.
- **Deep-link atom migrates** from `guideAnchorAtom: string | null` to
  `{ page, anchor }`. The sharp edge: in-app call sites that set it are TS string
  literals, invisible to any markdown link checker. Mitigation: a typed
  `GuideLinks` constant map (`GuideLinks.PIVOT = { page: "shape", anchor:
  "pivot" }`) so anchor renames are one-place edits and the link-check test can
  validate the map against real headings.
- **`rehype-slug` re-scopes heading ids per page after the split** — slugs that
  were globally de-duplicated in the one file will change. Budget a link-fixing
  pass, enforced by the link checker.

Smallest change to `Guide.tsx`: glob pages instead of one import; `currentPage`
state from the deep-link atom; a sidebar from `toc.json`; one relative-link
branch in `a()`; the two-field atom + scroll effect. ReactMarkdown, remark-gfm,
rehype-slug, the `img()` token handling, and the SVG glob are untouched (~80–100
lines net).

---

## Validation harness

**Decision: assert-and-check**, not build-time interpolation. The prose keeps
numbers as plain text; automated checks fail when a claim drifts. Keeps the
markdown clean for the public static build, ~90% of the guarantee for a fraction
of the change.

Three layers, each owned by whoever can check it cheaply:

| leg | asserts | status |
|---|---|---|
| **corpus** | engine output ↔ independent scipy reference | **exists** (`engine/validation/`) |
| **regenerate-and-diff** | committed assets (`.iris`, `.svg`, `manifest.json`) ↔ engine | **new, cheap** |
| **claim comments** | prose numbers ↔ manifest | **new, cheap** |

End to end: **prose ↔ engine ↔ ground truth.**

### Regenerate-and-diff (the keystone, highest guarantee-per-line)
A CI job: rerun `export_gallery.py`, then `git diff --exit-code
src/examples/assets/`. The exporter is already byte-deterministic, so this is
near-free — and it guards **figure drift**, not just numbers: for a tool branded
"the figure and the number can't disagree," a stale committed SVG is as bad as a
stale number. Build this first.

### Claim comments (prose ↔ manifest)
- Each documented case declares its documentable numbers next to its existing
  reference assertions, as **display strings** (formatting lives in Python, where
  the result schema is native):
  ```python
  def doc_numbers(res):
      return {"n_units": f"n = {res.groups[0].n_units}",
              "r":       f"r = {res.r:.2f}"}
  ```
- `export_gallery.py` dumps these into `manifest.json` as `docNumbers` per case.
- Prose binds with an **invisible HTML comment adjacent to the claim**:
  `The correlation is strong (r = -0.91). <!-- claim: pairs-neg.r -->`
  react-markdown strips raw HTML (no `rehype-raw`), so it never renders; the test
  reads the raw `.md` and sees it. **Locality is the win**: when we split the
  doc, the claim moves *with its sentence*, and the check scopes to the
  containing paragraph — killing the false-pass problem of a bare whole-doc
  substring search and the churn of a central fixture file.
- A **frontend-only, engine-free vitest** globs `docs/guide/**/*.md`, parses
  claim comments, and asserts `manifest.docNumbers[case][key]` appears in the
  adjacent paragraph. Fast, every PR.

### Referential + internal-link integrity (a real failing test)
- vitest, globs all `docs/guide/**/*.md`, extracts tokens by **reusing
  `parseExampleToken` / `parseOpenToken`** (never a second regex that can drift
  from the renderer). Asserts every `example:` → a manifest case+analysis *and*
  the SVG asset exists; every `iris-open:` → a manifest case; warns on orphan
  gallery cases referenced nowhere.
- Extend to internal links: parse headings with `github-slugger` (the algorithm
  rehype-slug uses), assert every relative `./x.md#anchor` resolves, and
  `toc.json` ↔ files is a bijection.
- Glob-based, so it works on the flat file **today** and survives the split
  untouched.

### Coverage-decay guard
A warning-level lint that regexes docs for suspicious *unclaimed* numeric
patterns (`n = \d+`, `r = -?\d\.\d+`, `p [<=] 0?\.\d+`) against an allowlist, so
new numbers can't accrete unchecked and rot the harness into covering only the
original lines.

### Glossary — single source
`src/components/statsGlossary.ts` stays the source of truth; a small node script
generates `docs/guide/reference/glossary.md` (marked DO-NOT-EDIT), enforced by
the same regenerate-and-diff discipline. Inverting the dependency (glossary data
→ JSON consumed by both the UI and the doc build) is cleaner long-term but a
bigger change for no extra guarantee today — deferred.

### Authoring rule (non-negotiable, write it in the docs README)
A number in a *claiming* sentence must be written as the **exact** string
`doc_numbers` emits — `n = 3`, not `n=3` or "three". The rigidity is the feature:
it's what makes the check mean anything.

---

## Sequencing

Artur's call: **write the prose first.** The content is the product and it
pressure-tests the IA better than up-front structure debate; the "Get your data
in" hole in particular has zero mechanism dependency. The reconciliation that
keeps this from costing us the safety nets: **annotate numeric claims with
`<!-- claim: … -->` markers from the first draft**, so the harness is later
retrofitted onto already-annotated prose rather than us combing back through it.

Working order:

1. **Write prose** into the target IA, in new `docs/guide/**` files, with claim
   comments on every hard number as we go. Start with the landing page,
   Quickstart, and the "Get your data in" hole; then migrate/rewrite existing
   sections into their pages. *(The load-bearing discipline when moving existing
   text: never rewrite prose in the same change that moves it — move first, then
   rewrite, so diffs stay reviewable.)*
2. **Renderer** — multi-file glob, `toc.json`, sidebar, relative-link branch,
   deep-link atom migration + typed `GuideLinks`.
3. **Safety nets** — regenerate-and-diff CI; referential + internal-link vitest;
   the `doc_numbers` → `manifest.docNumbers` → claim-comment check; coverage lint.
   (These can land against the flat file early too; ordering them after the prose
   is Artur's sequencing, but nothing stops the regenerate-and-diff job going in
   first — it's pure upside and content-independent.)
4. **Glossary generator** + generated reference page (independent; anytime).
5. **Public static build** consuming the same tree + `toc.json`; a remark plugin
   for the two token schemes; whole-doc search.

---

## Open decisions

- **Scope/appetite** — full arc vs. prose + nets first, reassess. (Leaning:
  prose first per Artur, with the regenerate-and-diff net slipped in early since
  it's free and content-independent.)
- **Claim comments in prose** — accepted trade (invisible, local, robust) but it
  *is* metadata in the prose; flagged as a taste call.
- **Behavioral-claim checking** — see blind spots; decide whether to add it in
  the first harness pass or defer.

## Blind spots to keep in view

- **Figure drift is the bigger unguarded hole**, and regenerate-and-diff fixes it
  for free — do it first regardless of the prose-first ordering.
- **Behavioral prose drifts too**, not just numbers ("the picker selects the
  robust test when normality fails"). Cheap partial fix: export the selected test
  id / decision-path metadata per analysis into the manifest and make it
  claimable like a number. Most valuable on the "Add a test → Choosing" page,
  where the core correctness argument lives.
- **Loss of whole-doc Ctrl-F** — the flat doc's one virtue. Cheap mitigation: a
  "view as single page" toggle that concatenates all pages in toc order (they're
  already globbed in memory); also gives print/export for free.
- **Case IDs become public API** once the public site ships `iris-open:` tokens
  (they'll want an OS-level Tauri protocol handler). Costs nothing now — just
  don't rename gallery case IDs casually; say so in the exporter.
- **Do not skip the claims harness** on the theory that regenerate-and-diff
  "mostly covers it": the manifest can be perfectly fresh while the sentence next
  to the figure states a stale number. Both legs are needed; both are small.
</content>
</invoke>
