# Lab-book-bound Iris

A figure in the served lab book opens in Iris tied to its file. Edits redraw the
figure on the lab-book page.

## Rule

A lab-book figure is a pair of files with one stem: `name.iris`, holding exactly
one plot, and `name.svg`. Tables are copied into each `.iris`, because the files
are small (the 41 in the lab book total 5.9 MB) and a self-contained file is worth
more than the space. Copies of a table can drift, and nothing warns about that.

## Mnemosyne

`eln/figures.py` holds the rules and `/api/figures/<path>` exposes them.

- `GET` returns `plots`, `sha256` and `history` for a `.iris` under `documents/`
  or `reports/`.
- `PUT` takes `iris_base64`, `svg`, `base_sha256` and `session`. It refuses a file
  without exactly one plot (422), a file changed since it was opened (409), and an
  origin other than the configured Iris or the lab book itself (403).
- The first save of a session copies the previous pair to
  `<dir>/.versions/<stem>/<stamp>.{iris,svg}`. This copy is the only history a
  `.iris` has, because the data repo ignores `*.iris`.
- Every save appends to `<dir>/.versions/<stem>/log.jsonl`: time, session, hashes
  before and after, and the hash of the previous line.
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
- After 2 s without an edit, and on Save, Iris saves the document, exports the SVG
  and sends both. Saves never overlap. The top bar shows the state, and a refused
  save stays visible until a later one succeeds.

## Not built

The check for figures that a script regenerates: rerunning such a script overwrites
an edit, although the version folder still holds it. There is also no browsing UI
for versions, and no save-back from the static export.
