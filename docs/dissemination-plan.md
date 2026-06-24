# Iris — Dissemination & Publication Plan

A long-term, deliberately-deferred plan for *how Iris reaches people and makes
its case* — distinct from [ROADMAP.md](../ROADMAP.md), which covers what the
tool does. Nothing here is on the critical path; it's written down so the
decisions are made deliberately rather than by default, and so the framing work
can be harvested for free from work already happening (the dogfooding dataset,
the examples gallery, the validation corpus).

This is a record of a strategy discussion, not a commitment. Revisit once the
tool is in front of real researchers.

## The core insight: three artifacts, three timelines

Don't conflate "publish a paper" into one thing. There are three separable
artifacts, each with its own audience and its own venue (or no venue):

1. **The tool → a citable handle.** JOSS is sufficient. A JOSS DOI is a
   perfectly good thing to cite, and the software-paper format (~1000 words,
   "here's what it does") is an honest fit. Venue is largely irrelevant here:
   useful tools get cited *on use*, regardless of where the paper lives.

2. **The handbook → a living website, no journal.** A citation-backed,
   interactive catalogue (data shape → recommended encoding → justified stat →
   the trap to avoid), where **every example is an openable, editable `.iris`**.
   This needs no peer review to exist or to be cited — compare data-to-viz.com,
   which is cited constantly and was never in a journal. This is the real
   contribution and the real *discovery surface*.

3. **The idea → an optional methods paper, later.** The argument that *silent,
   undocumented data-shaping (pivoting, nesting, aggregation, pseudoreplication)
   is a major reproducibility failure mode, and an explicit, guarded,
   exactly-reproducible transformation graph fixes a class of it.* JOSS
   structurally cannot carry this (reviewers would cut exactly the framing). A
   "Ten Simple Rules" (PLOS Comp Bio) or Patterns piece could. Only worth the
   effort if we decide we want to **influence the field**, not just serve the
   people who already found the tool.

The assets are the same regardless of which of these we pursue: the dogfooding
dataset, the catalogue entries, and the CI corpus serve all three. So the venue
decision can be deferred; what can't be deferred is being honest about the one
strategic question below.

## The open strategic question: acquisition vs retention

Cite-on-use is a *retention* mechanism — it assumes the person already found
Iris. It does nothing for *acquisition* (people who've never heard of it).

- If we only care about retention (serve the researchers who stumble onto it,
  excellently), **JOSS alone is genuinely enough** — ship it and stop.
- If we care about acquisition (change how cell biologists make figures), the
  handbook is the engine and a higher-profile framing paper is the on-ramp; JOSS
  alone leaves the best idea homeless.

This is the decision to make consciously, because it changes how much polish the
*framing* deserves relative to the code. Not yet decided.

## Why the argument is defensible (the thesis assets)

- **Visual *and* exact.** Most tools force a choice: exact-but-not-visual (code:
  scripts, Snakemake, targets) or visual-but-not-exact (Excel, Prism). Iris's
  claim is that this is a false tradeoff — a single canonical artifact is the
  executable spec, the visual editing surface, and the human-readable provenance
  record at once, with a lossless round-trip between the graph you *see* and the
  computation that *runs*.
- **The `.iris` format encodes data + code-by-commit-hash + full spec**, is
  human-readable, and is visually editable. Code-by-hash (not inlined code) is a
  *safety* property: a `.iris` is safe to open from an untrusted source because
  it runs pinned, auditable, version-controlled code, not embedded scripts.
  - *Soft spot to harden if this ever goes in a paper:* a commit hash reproduces
    only if the code stays retrievable, and pins our code but not necessarily the
    environment. Scope the claim honestly ("reproducible given a fixed,
    archived environment"), or pair the hash with a content-addressed snapshot.
- **The guards are the payoff, not a side feature.** Pairing-flip, identity-merge,
  pseudoreplication detection — these are only *possible* because the
  transformations are explicit and exact. They are the same silent errors that
  wreck reproducibility, caught before they reach the stats. (SuperPlots itself
  was a reproducibility paper about pseudoreplication.)
- **"file = entry = CI test" is the comprehensiveness argument.** Coverage isn't
  *asserted*, it's an executable, continuously-verified test suite where every
  test is also a teaching example. Most tool papers can't say this. It is
  probably the single strongest sentence available to us.

## The build discipline that feeds all of this

The gate stays: *do we need it, or can we analyze something useful with it?* A
rich cell-and-nucleus tracking dataset is the guide and the dogfood. This is not
just hygiene — it hands us, for free, the most persuasive element any
reproducibility write-up can have: **one real, messy, end-to-end reproduction
from raw tracks to a publication figure.** That worked example outweighs pages of
argument, and it is also the validation case already in scope.

Catalogue entries should share a fixed template so the handbook stays
maintainable (the lesson of Distill's death — bespoke interactivity is
unsustainable; a *uniform* embedded `.iris` widget is not):

- the data shape (what you have)
- the recommended encoding + the live `.iris`
- *why* — cited justification (`docs/stats-recommendations.bib`)
- *the trap* — the common wrong choice, ideally one a guard catches
- *edit-me* — a variant to explore

Scope v1 to the cell-biology common cases (nested/replicate data, proportions,
distributions, paired designs, time series) — ~8–12 entries that cover most real
figures in the field and form a finishable release. Do not boil the ocean.

## Serving Iris online — three hosting tiers

The deciding fact: the engine is a heavyweight native Python stack (scipy /
statsmodels / pingouin / matplotlib). That stack determines cost. Tiers differ
by ~100× in both cost and effort.

### Tier 1 — static precomputed gallery — ~$0, days
Pre-render every example `.iris` (and a few variants each) to SVG + data table
via the existing exporter (`npm run examples:build` →
`python -m validation.export_gallery`); host on GitHub/Cloudflare/Netlify Pages
(free, infinitely scalable). Gives browse, zoom, read-the-graph, swap between
precomputed states, download the `.iris`. Does **not** give free-form editing.
This is the obvious **v1** — mostly a packaging task on top of the exporter.

### Tier 3 — Pyodide / WASM, engine runs in the browser — ~$0 hosting, weeks
Compile the engine to WASM; it runs entirely client-side, so hosting is still
static/~$0. **Perfect fit for the "no upload for safety" constraint: there is no
server, so data physically cannot leave the browser** — it preserves the "all
compute is local, your data never leaves the machine" promise *online*. Cost is
engineering, not money: decouple the engine from the Tauri/frozen-binary path,
accept a ~30–60 MB cached first-load. This is the real "manipulate the examples"
(and eventually "bring your own data, safely") version.
- *Note vs ROADMAP:* Pyodide-*first as the primary architecture* was considered
  and rejected. This is the narrower, already-acknowledged Tier-4 "Pyodide
  browser demo" use — a read/explore target, not a replacement for the desktop
  engine. The spec/protocol keeping the engine swappable is what makes it
  expensive-but-not-a-rewrite.

### Tier 2 — hosted Python backend — ~$0–10/mo, real operational risk
Engine on a server; browser sends spec edits, gets a rendered figure back. Full
interactivity, no porting. A small box (Hetzner ~€4/mo, Render $7/mo) with
scale-to-zero (Cloud Run / Fly auto-stop) idles near $0 and pays per
request-second — realistically <$10/mo for gallery traffic. Downsides: running
matplotlib per request (sandbox, rate-limit, concurrency-cap) and bill-spike
risk on a viral moment. Only reach for this if Tier 3 porting proves genuinely
painful.

**Recommendation:** Tier 1 now (free, immediate), Tier 3 as the eventual
editable/zero-upload version (uniquely keeps the privacy promise and costs
nothing to host). Skip Tier 2 unless forced.

### Licensing note
Iris is **AGPL-3.0**. Serving it over a network (Tier 2 especially) triggers the
network clause: users must be offered the source. Since the project is already
open, that's a "link to the repo" footer, not a blocker.

## Related

- [ROADMAP.md](../ROADMAP.md) — Tier 4 "Pyodide browser demo", and the
  "Provenance is product" / "the spec is the contract" principles this plan
  leans on.
- `docs/superpowers/specs/2026-06-24-iris-file-format-redesign-design.md` — the
  `.iris` format whose properties (data + code-by-hash + spec) carry the
  reproducibility argument.
- `docs/superpowers/specs/2026-06-22-examples-gallery-design.md` and
  `validation/export_gallery` — the exporter Tier 1 builds on.
- `docs/stats-recommendations.bib` — the citation backbone for handbook entries.
