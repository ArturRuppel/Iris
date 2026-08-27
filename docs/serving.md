# Serving Iris over the tailnet

Iris normally runs as a desktop app: the Tauri shell spawns the Python engine as
a loopback sidecar and serves the built frontend itself. **Served mode** is the
other deployment — one long-running engine that hands out the frontend *and*
answers the API on a single origin, reachable from the phone and the iPad.

It is the same arrangement as `labbook` and `lit` on this machine: a
`systemd --user` unit, bound to the tailnet address, with a row in
[switchboard](https://github.com/…/switchboard).

```
iPhone / iPad ──┐
                ├── tailnet (WireGuard) ──► rocinante:8766 ── iris.service
laptop browser ─┘                                              ├─ GET  /            → dist/index.html
                                                               ├─ GET  /assets/…    → the bundle
                                                               └─ POST /analyze …   → the engine
```

## Running it

```bash
npm run build                                   # served mode refuses to start without dist/
cp systemd/iris.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now iris
```

Then `http://<tailnet-ip>:8766`. `tailscale ip -4` prints the address; the unit
resolves it the same way at startup.

**After any frontend change:** `npm run build && systemctl --user restart iris`.
The engine serves `dist/` off disk, so a rebuild alone is not enough for the
Python process to notice — and a stale bundle is the failure that looks like
"my change did nothing".

## Why these choices

**Port 8766, not 8765.** 8765 is the dev/sidecar port. Separating them means
`./dev.sh` and the service can run at once, which is the normal state of affairs
while working on Iris from the laptop.

**`dev.sh` will not kill the service.** It clears stale engines with
`pkill -f 'iris_engine\.main$'`, and that `$` anchor is load-bearing: the service
runs as `iris_engine.main --serve`, so it does not match. Remove the anchor and
every dev run takes the phone's app down with it.

**Bound to the tailnet address, not `0.0.0.0`.** The engine's endpoints edit
session tables and write autosave snapshots — no authentication, because as a
sidecar it never needed any. The tailnet is the only network where every peer is
an authenticated device of yours, so it is the only one this may listen on.
Binding `0.0.0.0` would expose those writes to whatever café LAN the laptop is
on. `lit.service` binds the same way for the same reason.

If Tailscale is not up when the unit starts, `--serve` exits with a message and
systemd retries every 5 s.

**One origin, so no CORS.** The `allow_origins` list in `main.py` covers the Vite
dev server and the Tauri shell. Served mode does not appear in it and does not
need to: the page and the API come from the same origin, so the requests are not
cross-origin at all.

**No service worker.** Iris is worthless offline in this mode — the statistics
and the figure rendering are all in the Python engine on the laptop, so a cached
shell would only buy a prettier error when the laptop is asleep. What it would
cost is the bug switchboard's README documents at length: a cached shell that
has silently stopped matching its source. Not a trade worth making.

## Installing it on the phone

Open `http://<tailnet-ip>:8766` in Safari → Share → **Add to Home Screen**. It
launches standalone: no address bar, its own icon, its own app-switcher entry.

Three details, because each fails silently when missing:

- **iOS reads `apple-touch-icon`, not the manifest's `icons`.** Without it Safari
  screenshots the page and uses *that* as the icon. `_mount_frontend` also serves
  `/apple-touch-icon.png` at the document root, because iOS asks for it there
  whatever the markup says.
- **The manifest must be `application/manifest+json`.** Starlette takes the type
  from the OS mime database, and a machine whose `/etc/mime.types` predates
  `.webmanifest` serves `application/octet-stream`, which **Safari ignores
  without saying anything** — you get a bookmark, not an app.
  `mimetypes.add_type` in `main.py` removes that dependency.
- **`black-translucent` and the safe-area padding are a pair.** The status-bar
  style puts the page under the notch; `.app` carries `env(safe-area-inset-*)` to
  put it back. One without the other hides the header in standalone mode *only*,
  which is exactly where you will not be testing.

`tools/make-icons.sh` rasterises `public/iris-favicon.svg` into the three PNGs.
The SVG is the source of truth; the PNGs are committed anyway, because an icon
that regenerates differently on a machine with a different rasteriser is a worse
deal than a few KB in git.

**Android install is not available and that is not an oversight.** Chrome
requires a secure origin, and `tailscale cert` reports this account cannot issue
certs — the same wall that rules out `tailscale serve`. So this is deliberately
an iOS-shaped PWA. On the tailnet the traffic is WireGuard-encrypted regardless.

## What does not work yet

**The layout is a desktop layout.** Iris is built at 1280×840 around AG Grid and
a React Flow workbench, and the CSS has no breakpoints. On the iPad in landscape
it is usable; on a phone it is not, and no amount of PWA packaging changes that —
it needs a responsive pass, and a node graph needs a real touch interaction
model. Installing it on the phone today gets you a correctly-installed app that
is still too small to work in.

**One engine means one implicit session.** `_SESSIONS` is a module-level store
and `autosave.default_dir()` is a single per-user slot. Two clients — the laptop
browser and the phone — will not collide on table ids, but they *will* clobber
each other's autosave snapshot. Fine for one person on one device at a time;
worth fixing before it is ever two.

**Web fonts come from Google.** `index.html` loads IBM Plex from
`fonts.googleapis.com`, so a device with no route to the public internet gets the
fallback stack. Self-hosting them is the fix if that ever matters.
