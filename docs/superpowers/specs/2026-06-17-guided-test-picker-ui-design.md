# Guided test picker — surfacing the choice as questions

**Date:** 2026-06-17
**Status:** Draft

## Problem

We decided a while back that Iris should not silently pick a statistical test
and present it as a fait accompli. Instead it should **guide the user to the
choice by asking the questions a statistician would ask** — is your design
independent or paired? do your data meet the parametric assumption or should we
stay robust? — recommend an answer to each, explain why, and let the user
confirm or change it. The chosen test then falls out of the answers.

Half of that shipped. Commit `a4ae47f` ("feat(stats): guided test picker") built
the **engine and data model** for it:

- `group_comparison` (`engine/iris_engine/stats.py:228`) resolves a two-group
  comparison on a **two-question grid** — a *structural* axis (independent vs
  paired) × an *assumption* axis (parametric vs robust) — and combines the two
  answers into one of `welch_t` / `mann_whitney` / `paired_t` / `wilcoxon` via
  `_COMBINE` (`stats.py:79`).
- It returns a `decision` object recording, **per question**, the
  `recommended` answer, the `chosen` answer, `chosen_by`
  (`recommendation_accepted` | `user_override`), a human `reason`, and the
  available `options` (`stats.py:309`).
- The frontend type models it: `StatsResult.decision = { structural,
  assumption }`, each a `StatsDecision` (`src/types.ts:295`, `:308`).

The **UI half was never built.** `StatsPanel.tsx` does not read `s.decision`
anywhere — grep confirms the only reference to `decision` / `StatsDecision` in
`src/` is the type definition. The pane still renders the *old* shape it had
before the redesign:

- one flat "Recommended test" line (`StatsPanel.tsx:205`), then
- a row of override **chips** — every test in the family, click one to pin it
  (`StatsPanel.tsx:217`).

So the user is never *asked* anything. The structural answer is decided for them
(paired chips silently appear or vanish based on `model.pairing`,
`StatsPanel.tsx:168`); the assumption answer is buried in a lone "Parametric vs
robust" label sitting above an undifferentiated chip row (`StatsPanel.tsx:213`).
The provenance the engine carefully records per question is thrown away. This
spec defines the UI that consumes `s.decision` and turns it into the guided,
question-led choice we designed.

## Decision summary

- Replace the single "Recommended test → override chips" block with a
  **stack of question cards**, one per decision axis, driven by `s.decision`.
- Each card states the **question**, shows its **options** as a segmented
  control with the engine's recommended option pre-selected and badged
  ("Recommended"), and shows the engine's **reason** for that recommendation.
- The **resolved test is derived**, not chosen directly: the user answers
  questions; Iris shows the test the answers produce ("→ Welch's t-test") as a
  read-only consequence, not another control to fight with.
- Answers map back to the engine's existing single-`override` API by mirroring
  `_COMBINE` on the frontend. We do **not** change the engine contract.
- When an axis has only one real option (e.g. structural with no pairing
  available → `options: ["independent"]`), the card renders as a **stated fact**
  with its reason, not a control — the question is still *shown and answered*,
  just not adjustable.
- Families the engine does not (yet) return a `decision` for — multi-group,
  correlation, contingency — keep today's chip row as a **fallback**, unchanged.
  Extending `decision` to them is a follow-on (see Out of scope / Open
  questions), but the UI is written so they upgrade automatically once the
  engine emits it.
- This is primarily a **frontend** change. The engine already produces
  everything the 2-group cards need.

## The questions

Source of truth is `s.decision` (present only for the two-group numeric family
today). Each axis is a `StatsDecision`:

```ts
interface StatsDecision {
  recommended: string;   // structural: "independent" | "paired"
  chosen: string;        // assumption:  "parametric"  | "robust"
  chosen_by: "recommendation_accepted" | "user_override";
  reason: string;        // engine prose, shown verbatim
  options: string[];     // structural: ["independent"] or ["independent","paired"]
}                        // assumption: ["parametric","robust"]
```

| Axis | Question shown | Options | Recommended from |
|---|---|---|---|
| `structural` | "Are the two groups independent, or paired measurements of the same unit?" | independent / paired | the spine-derived `model.pairing` (no user declaration) |
| `assumption` | "Compare with a parametric test, or stay robust?" | parametric / robust | the Shapiro–Wilk check + small-n rule |

The resolved test is `_COMBINE[(structural.chosen, assumption.chosen)]` and is
shown as the card stack's footer. It always equals `s.result.test`, so the
footer label can read straight from the result.

## Affordance

```
┌────────────────────────────────────────────────┐
│ Choosing the test                            ⓘ │
│                                                  │
│ ① Study design          independent vs paired ⓘ │
│   ┌────────────┬──────────┐                      │
│   │ Independent│  Paired   │   ✓ Recommended     │
│   └────────────┴──────────┘                      │
│   The two groups share no coarser unit, so the   │
│   observations are independent.                  │
│                                                  │
│ ② Distribution        parametric vs robust    ⓘ │
│   ┌────────────┬──────────┐                      │
│   │ Parametric │  Robust   │   ✓ Recommended     │
│   └────────────┴──────────┘                      │
│   Shapiro–Wilk is consistent with normality.     │
│                                                  │
│ ───────────────────────────────────────────────  │
│ → Welch's t-test          (recommended)       ⓘ │
└────────────────────────────────────────────────┘
```

When the user changes an answer:

```
│ ② Distribution        parametric vs robust    ⓘ │
│   ┌────────────┬──────────┐                      │
│   │ Parametric │ �show▶Robust│  ⟲ changed         │
│   └────────────┴──────────┘                      │
│   Shapiro–Wilk is consistent with normality.     │
│   You chose robust — recorded as an override.    │
│ ...                                              │
│ → Mann–Whitney U          (your override)     ⓘ │
```

- The segmented control is a `radiogroup`; each option is a `radio`. The
  recommended option carries a small "Recommended" badge until the user picks
  another, after which the changed option carries a "changed / override" mark
  and a one-line note appears.
- A single-option axis (`options.length === 1`) renders the same card frame but
  as static text: "Independent — the two groups share no coarser unit…", no
  control. The question is still surfaced and answered; it just isn't
  adjustable, which is honest (paired genuinely isn't available without a shared
  unit).
- The footer "→ {test}" restates whether it is the recommendation or an
  override, mirroring the existing `override-note` copy.
- `ⓘ` info tips reuse the existing `InfoTip` keys: `independent_vs_paired`,
  `parametric_vs_robust`, `recommended_vs_override`, and one key per test name
  on the footer (the same keys the old chips used). No new glossary copy needed
  — those entries already exist (`statsGlossary.ts`).

## Interaction & state

The engine API is unchanged: it accepts a single `override` test name
(`active.override`, `StatsPanel.tsx:157`). The two-question UI maps to it.

- **Frontend `_COMBINE` mirror.** Add the same 2×2 map the engine uses:
  `{ independent×parametric: welch_t, independent×robust: mann_whitney,
  paired×parametric: paired_t, paired×robust: wilcoxon }`. Selecting an answer
  recomputes `combine(structuralChosen, assumptionChosen)` and sets
  `active.override` to that test name — **or to `null`** when the combination
  equals the recommendation, so an unchanged pair sends no override and the
  engine reports `recommendation_accepted` (matching today's "set override to
  null when it equals rec" rule at `StatsPanel.tsx:223`).
- **Initial state.** The current answers come *from the engine response*:
  `decision.structural.chosen` / `decision.assumption.chosen`. The component
  does not hold its own answer state — it reflects `s.decision` and writes
  `active.override`. The next `/analyze` round-trip returns the updated
  `decision`, closing the loop. This keeps the panel a pure function of server
  state, like the rest of the pane.
- **Disallowed combinations.** A paired answer is only offerable when
  `structural.options` includes `"paired"`; the engine already errors if a
  paired test is forced without pairing (`stats.py:254`). The single-option
  rendering makes the bad combination unreachable from the UI.
- **Describe-only** (`StatsPanel.tsx:184`) sits above the question stack
  unchanged; when ticked, the whole "Choosing the test" block is hidden exactly
  as the recommendation block is today (`model.chosen_by === "describe_only"`).
- **Reset.** A small "use recommendation" link on a changed card sets that
  axis back to its recommended option (and clears `override` if both axes are
  then at their recommendation). Cheap, and it makes overrides reversible
  without re-reasoning.

## Provenance & methods text

No change required — the engine already writes per-question provenance into
`decision[axis].chosen_by` and folds the override into `methods_text`
(`stats.py`). The UI now simply *shows* the provenance it was always recording:
the "Recommended" badge ⇄ "override" mark on each card is the visible form of
`chosen_by`. The methods paragraph and the `chosen_by` recorded in the saved
spec (`src/state.ts:341`) are untouched.

## Families and fallback

| Family | `s.decision` today | UI |
|---|---|---|
| Two-group numeric (welch/mann/paired/wilcoxon) | **present** (both axes) | full question stack |
| Multi-group (>2 levels: ANOVA / Kruskal) | absent — `multi_group_comparison` emits no `decision`; structural is always independent, only the assumption axis is live | **fallback chips** now; one-question card once the engine emits an `assumption`-only `decision` (follow-on) |
| Correlation (pearson / spearman) | absent | fallback chips now; assumption-only card later |
| Contingency (chi-square / fisher) | absent — the choice is driven by expected-cell counts, not a user axis | **keep chips** — this isn't a "guide me" choice, it's an automatic fallback; leave as is |
| Descriptive | n/a — no test | no card |

The component branches on `s.decision`: render the question stack when present,
otherwise render today's `alternatives` chip row (`StatsPanel.tsx:212-230`)
verbatim. So nothing regresses, and multi-group/correlation light up the moment
the engine grows the matching `decision` block.

## Implementation sketch

- `src/components/StatsPanel.tsx`
  - Add `combineGroupTest(structural, assumption)` mirroring engine `_COMBINE`.
  - Extract the recommendation/override block (lines 201–231) and replace its
    non-describe-only branch with a `<GuidedTestPicker decision={s.decision}
    … />` when `s.decision` is present, else the existing chip row.
  - The picker writes `active.override` via the existing `setOverride`, using
    `combineGroupTest`, nulling when the pair equals the recommendation.
- `src/components/GuidedTestPicker.tsx` (new, ~80 lines)
  - Props: the two `StatsDecision`s, the resolved test name + whether it's an
    override, and `onChange(structural, assumption)`.
  - Renders the two cards (segmented `radiogroup` or static line per
    `options.length`), the reason prose, the badge/override marks, the reset
    link, and the "→ test" footer. Reuses `TEST_LABELS` and `InfoTip`.
- CSS in `index.css` alongside `.stats-pane`: `.qcard`, `.seg`, `.seg .opt`,
  `.seg .opt.rec`, `.qcard .reason`, the footer rule. Matches the existing chip
  visual language so the pane stays coherent.
- Tests: a frontend test that, given an `analysis` fixture with `decision`,
  renders two cards, pre-selects the recommended options, and on selecting the
  non-recommended assumption option calls `setActive` with
  `override: "mann_whitney"`; and that a single-option structural axis renders
  static (no radio). Engine untouched, so its 207 tests stand.

## Out of scope

- Changing any statistic, recommendation, threshold, or the engine's
  `decision`/`_COMBINE` contract — this consumes what the engine already emits.
- Emitting `decision` for multi-group and correlation. It's the natural
  next step (the assumption axis already exists internally in
  `multi_group_comparison`), but it's an engine change with its own tests; this
  spec only makes the UI ready to consume it. Tracked as a follow-on.
- A paired multi-group path (RM-ANOVA / Friedman) — already out of scope per
  `stats.py:244`.
- Contingency as a guided choice — its chi-square ⇄ Fisher switch is an
  automatic small-count fallback, not a user-facing question.
- Localisation; English copy only.

## Open questions

1. **Segmented control vs two chips.** A segmented radiogroup reads as "pick
   one of these two answers"; two standalone chips read as "toggle." The
   segmented control better signals these are mutually exclusive *answers to a
   question*. Recommend segmented. Confirm.
2. **Show the derived test as a footer, or also keep it as the `Result`
   heading?** The `Result` section already names the test implicitly through its
   rows. The footer "→ Welch's t-test" is the explicit consequence of the
   answers. Leaning: keep the footer (it closes the question→test loop) and
   leave Result as-is.
3. **Live re-analyze on answer change, or stage and apply?** Today an override
   triggers a re-`/analyze` round-trip immediately. The question UI inherits
   that — change an answer, the pane refreshes. Fine for two cheap axes;
   flagging in case we'd rather stage both answers and apply once.
4. **Single-option axis: show it at all?** Showing "Independent — (reason)" as a
   stated fact teaches the user *why* paired wasn't offered, which is the whole
   point of guiding. Recommend keeping it visible rather than hiding the card.
   Confirm.
