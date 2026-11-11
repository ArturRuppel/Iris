# Lab-book-bound Iris

A figure in the served lab book opens in Iris tied to its file. Edits redraw the
figure on the lab-book page.

## Rule

A lab-book figure is a pair of files with one stem: `name.iris`, holding exactly
one plot, and `name.svg`. Tables are copied into each `.iris`, because the files
are small and a self-contained file is worth more than the space. Copies of a table can drift, and nothing warns about that.

## Mnemosyne

`eln/figures.py` holds the rules and `/api/figures/<path>` exposes them.

- `GET` returns `plots`, `sha256`, `iris_url` and `history` for a `.iris` under `documents/`
  or `reports/`.
- `PUT` takes `iris_base64`, `svg`, `base_sha256` and `session`. It refuses a file
  without exactly one plot (422), a file changed since it was opened (409), and an
  origin other than the configured Iris or the lab book itself (403).
- The data repo tracks `*.iris`, so earlier states live in git once committed. A
  save does not commit, because the server's clone must stay able to fast-forward.
- Every save appends to `<stem>.log.jsonl` beside the figure: time, session, hashes
  before and after, and the hash of the previous line. A state that was saved and
  never committed therefore leaves a trace, although its content is gone.
- `edit-overlay.js` runs only on the live server, so the static export never gets
  these links. For each SVG image whose sibling `.iris` holds one plot, it links
  the image to `<iris_url>/?labbook=<url of the .iris>`. It reloads the image when
  the tab becomes visible again.
- `iris_url` is set in `labbook.toml`. Without it there are no links and `PUT` is
  refused.

## Iris

`?labbook=<url>` loads the file as `?open=` does and binds the session to it.

- The query stays in the address, so a reload reopens the saved file.
- New, Load, Save As, the tutorial and the examples are hidden, and Add plot and
  Duplicate are disabled. Data, Workbench, Import and Export stay.
- Crash recovery is skipped, because the lab book is the saved state. A leftover
  autosave slot is left alone for an ordinary session to offer.
- A file without exactly one plot opens with a notice and does not save back.
- A figure is a record, so only Save to lab book rewrites it; exploring does not.
  The top bar shows unsaved edits, and closing the page with some asks first. A
  refused save stays visible until a later one succeeds.
- A save keeps the provenance the file already had and adds `hand_edited` (time and
  session).

## Export

The static export has no server, so a figure there is never bound. For each SVG with a
one-plot `.iris` beside it, `eln/share.py` copies the `.iris` in as itself and as
`name.iris.js`, a classic script calling `__irisDocument` with the file, its lab-book
path and its hash, because a page opened over `file://` can run a neighbouring script
but cannot fetch a neighbouring file. The image links to
`iris/index.html?embedded=../<path>.iris.js`, titled "Open a copy in Iris".

`?embedded=<url>` in the browser build loads that script and opens the document as an
ordinary detached session: New, Load and Save As stay, Save writes a `.iris` to the
colleague's disk, and no autosave slot is used. A detached save keeps the provenance
the file was opened with (the bound save already did) and adds `derived_from` with the
figure's name, path, hash and the time, so a colleague's version still names the
figure it came from. `?open=` records the same for a file opened by URL.

## Build scripts

Most lab-book figures come from a script, so a figure can have two writers, and the
hand edit wins. A build script calls `document.refuse_hand_edited(paths, force)` before
writing anything, and raises `HandEditedError` for a marked `.iris` unless told to
overwrite. The script must make this call: nothing else stops it writing the file.

## Limits

- `PUT` is guarded only by the Origin header and the tailnet. An Origin header can be
  set by any client that is not a browser, so any tailnet member can rewrite a figure.
- Safari and iPad are untested for the browser build.
- There is no browsing UI for the log or for earlier versions. The static export opens
  copies only, by design.
- Only an SVG with a one-plot `.iris` of the same stem beside it is a figure. The
  older report figures keep their `.iris` next to the markdown and their SVG under
  `figures/`, so neither the live link nor the export finds them until they are moved.
