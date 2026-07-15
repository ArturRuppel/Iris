# Contributing to Iris

Iris is early and under active development. The most valuable thing you can give
it right now is not a pull request: it is a report of where it broke on your
real data. Iris exists to be trusted with numbers that end up in papers, and the
only way to earn that is for it to meet data its author never imagined.

This page covers what to send, how to run the checks, and the rules that aren't
up for negotiation.

## The one rule

**No test the data doesn't support.** Iris is aimed at researchers who can read
a p-value but not audit the code that produced it, which means every number it
shows is taken on trust. A change that makes a test easier to reach, a figure
prettier, or a workflow smoother is worth nothing if it lets someone publish a
statistic their design can't carry.

In practice this means a contribution must not:

- reimplement a statistical procedure. Inference comes from scipy, statsmodels,
  and pingouin: battle-tested and citable. If the library doesn't offer it, that
  is a finding, not an invitation.
- widen a test's applicability without widening its guards. If a family becomes
  reachable for a new data shape, the assumption checks and the effect size come
  with it.
- let the plot and the test diverge. Both compile from one spec. That is the
  whole architecture, and a shortcut around it is a bug even when it renders.

The rest is discussable. This isn't.

## Report a bug

Open an issue with the smallest input that reproduces it, plus what you expected
and what you got.

The best attachment is the `.iris` document itself: it holds the data and the
full analysis spec, so it reproduces the state exactly rather than
approximately. It holds your data, though. If the data is unpublished or
sensitive, don't attach it: reproduce the problem on a handful of invented rows
and send that instead. A three-row table that fails is worth more than a real
one nobody can open.

If the app misbehaves rather than crashes, say which of the two halves you
suspect: the engine logs to the terminal that started it, and the frontend logs
to the browser console.

## Set up

You need Python 3.10+, Node 18+, and a Linux machine for the verified path.
[README.md](README.md#quickstart-dev-mode) has the short version; for
development you want the dev tooling too:

```bash
pip install -e "engine[server]"            # engine + FastAPI service
pip install -r engine/requirements-dev.txt # pytest, pyinstaller
npm install
./dev.sh                                   # engine + Vite, on :5173
```

## Run the checks

There is no CI yet, so these run on your machine before you open a pull request.
All four are expected to pass.

```bash
# 1. Engine internals
cd engine && python -m pytest tests

# 2. Validation corpus: every stat family against independent scipy references
cd engine && python -m pytest validation

# 3. Frontend units
npm test

# 4. Strict TypeScript + production build
npm run build
```

The end-to-end tests drive a real browser against a running dev stack, so they
need one started first:

```bash
npx playwright install chromium   # once
./dev.sh                          # in another terminal
node e2e/superplot_test.mjs       # any file in e2e/
```

If you touch the engine's statistics or its rendering, the validation corpus
(`engine/validation/`) is the one that matters. Read its
[README](engine/validation/README.md) before adding a case: each case asserts
against reference values recomputed independently with raw scipy, never against
Iris's own output. A case that checks Iris agrees with Iris is worse than no
case, because it looks like evidence.

## Propose a change

Open an issue before writing code for anything beyond a bug fix. Scope is
arbitrated by need, not breadth: features are judged against real analyses real
researchers are trying to finish, not against a competitor's feature list.
[ROADMAP.md](ROADMAP.md) says what is planned and, more usefully, what is
deliberately deferred. Something in the deferred list isn't forgotten; it was
declined for a reason, and the issue is the place to argue the reason is wrong.

A good pull request is one concern, with tests, and a description saying what
you verified rather than what you intended.

## House rules for the code

Match the surrounding code before you match your own habits. Beyond that:

- The engine's render and stats core stays free of the web framework. FastAPI is
  an optional extra used only by the GUI; a core module that imports it is a
  layering break.
- Screen and export are the same renderer at the same physical size. A style
  path that only fixes the preview will diverge from the PDF, which is the
  artifact that matters.
- Iris has no installed base, so we don't carry compatibility shims. If a design
  is wrong, replace it and delete the old path rather than deprecating it.
- Prose in `docs/` follows the house style: purpose before mechanism, concrete
  examples over abstractions, no em-dashes.

## License

Iris is [AGPL-3.0](LICENSE). Contributions are accepted under the same license,
and the network clause is deliberate: a hosted Iris owes its users its source.
By opening a pull request you affirm you wrote the code, or that you have the
right to submit it under AGPL-3.0.
