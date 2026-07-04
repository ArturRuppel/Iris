"""Methods-text / statistics-table assembly (pure formatting over computed stats)."""
import csv
import io

from iris_engine import methods


# ── fixtures: minimal analyses mirroring the shapes stats.py returns ──────────

def _analysis(title, stats, spec=None):
    return {"title": title, "spec": spec or {}, "stats": stats,
            "stat_model": {}}


WELCH = _analysis("Fig 1", {
    "family": "group_comparison",
    "result": {"test": "welch_t", "t": 2.41, "df": 12.3, "p": 0.032, "n": 20,
               "effect": {"name": "hedges_g", "value": 0.62, "ci": [0.1, 1.14]}},
    "methods_text": "Response was compared using Welch's t-test.",
})

MANNWHITNEY = _analysis("Fig 2", {
    "family": "group_comparison",
    "result": {"test": "mann_whitney", "U": 88.0, "p": 0.004,
               "effect": {"name": "rank_biserial", "value": -0.41, "ci": None}},
    "methods_text": "Compared with the Mann–Whitney U test.",
})

ANOVA = _analysis("Fig 3", {
    "family": "group_comparison",
    "result": {"test": "one_way_anova", "F": 5.2, "df_between": 2, "df_within": 27,
               "p": 0.012, "n": 30, "k": 3,
               "effect": {"name": "eta_squared", "value": 0.28, "ci": None},
               "correction": "tukey",
               "pairwise": [
                   {"a": "ctrl", "b": "low", "p_adj": 0.20, "stars": "ns",
                    "effect": {"name": "hedges_g", "value": 0.3}},
                   {"a": "ctrl", "b": "high", "p_adj": 0.008, "stars": "**",
                    "effect": {"name": "hedges_g", "value": 1.1}},
               ]},
    "methods_text": "One-way ANOVA with Tukey's HSD.",
})

LOCATION = _analysis("Fig 4", {
    "family": "location", "reference": 0.0,
    "result": {"test": "one_sample_t", "p": 0.01, "n": 6,
               "effect": {"name": "cohens_dz", "value": 0.9, "ci": None}},
    "per_group": [
        {"level": "drug_a", "test": "one_sample_t", "t": 3.1, "df": 5, "p": 0.01,
         "stars": "*", "n": 6, "effect": {"name": "cohens_dz", "value": 0.9}},
        {"level": "drug_b", "test": "none", "p": None, "n": 2,
         "effect": {"name": "none", "value": 0.0}},  # too few → skipped in table
    ],
    "methods_text": "Tested against 0 with a one-sample t-test.",
})

RATE = _analysis("Fig 5", {
    "family": "rate", "model": "nb",
    "result": {"test": "nb_glm", "p": 0.03, "n": 40,
               "effect": {"name": "none", "value": 0.0, "ci": None}},
    "decision": {"model": "nb", "global": {"test": "likelihood_ratio",
                                           "stat": 4.7, "df": 1, "p": 0.03}},
    "per_group": [
        {"level": "ctrl", "rate": 0.012, "ci": [0.008, 0.018], "n": 20},
        {"level": "drug", "rate": 0.025, "ci": None, "n": 20},
    ],
    "methods_text": "Modelled with a negative-binomial GLM.",
})

CORRELATION = _analysis("Fig 6", {
    "result": {"test": "pearson", "r": 0.55, "p": 0.001, "n": 48,
               "effect": {"name": "pearson_r", "value": 0.55, "ci": [0.31, 0.72]}},
    "methods_text": "Assessed by Pearson correlation.",
})

CONTINGENCY = _analysis("Fig 7", {
    "result": {"test": "chi_square", "chi2": 6.1, "dof": 2, "p": 0.047, "n": 120,
               "effect": {"name": "cramers_v", "value": 0.22, "ci": None}},
    "methods_text": "Tested with Pearson's chi-square test.",
})

FISHER = _analysis("Fig 8", {
    "result": {"test": "fisher_exact", "p": 0.02, "n": 40, "odds_ratio": 3.4,
               "effect": {"name": "odds_ratio", "value": 3.4, "ci": [1.2, 9.6]}},
    "methods_text": "Tested with Fisher's exact test.",
})

DESCRIBE = _analysis("Fig 9", {
    "result": {"test": "descriptive", "n": 50, "mean": 3.2, "sd": 1.1,
               "effect": {"name": "none", "value": 0.0, "ci": None}},
    "methods_text": "Summarized for n = 50.",
})

MANIFEST = {
    "engine": {"version": "0.4.0", "commit": "abc1234", "dirty": False},
    "engine_snapshot": {"python": "3.12.1", "scipy": "1.13.0",
                        "pingouin": "0.5.4", "pandas": "2.2.0"},
}


# ── stats_rows: one row per test, per family ──────────────────────────────────

def test_two_group_single_row():
    rows = methods.stats_rows(WELCH)
    assert len(rows) == 1
    r = rows[0]
    assert r["Test"] == "Welch's t-test"
    assert r["Statistic"] == "t(12.3) = 2.41"
    assert r["p"] == "0.032"
    assert r["n"] == "20"
    assert r["Effect size"] == "Hedges' g = 0.62 (95% CI 0.10 to 1.14)"


def test_two_group_n_falls_back_to_summaries():
    # welch_t / mann_whitney carry no combined result.n; the table sums per-group
    # summaries so the n cell is never blank.
    stats = {"family": "group_comparison", "summaries": [
        {"group": "a", "n": 12}, {"group": "b", "n": 8}],
        "result": {"test": "welch_t", "t": 2.0, "df": 17, "p": 0.06,
                   "effect": {"name": "hedges_g", "value": 0.4, "ci": None}},
        "methods_text": "x"}
    assert methods.stats_rows(_analysis("F", stats))[0]["n"] == "20"


def test_mann_whitney_integer_statistic_no_ci():
    r = methods.stats_rows(MANNWHITNEY)[0]
    assert r["Statistic"] == "U = 88"
    assert r["p"] == "0.004"
    assert r["Effect size"] == "rank-biserial r = -0.41"   # no CI clause


def test_omnibus_fans_out_to_pairwise_rows():
    rows = methods.stats_rows(ANOVA)
    assert len(rows) == 3                       # omnibus + 2 pairwise
    assert rows[0]["Comparison"] == "omnibus"
    assert rows[0]["Statistic"] == "F(2, 27) = 5.20"
    assert rows[0]["Effect size"].startswith("η² = 0.28")
    assert rows[1]["Comparison"] == "ctrl vs low"
    assert rows[1]["Test"] == "pairwise (tukey-corrected)"
    assert rows[2]["p"] == "0.008"
    assert rows[2]["Effect size"] == "Hedges' g = 1.10"


def test_kruskal_omnibus_statistic():
    stats = dict(ANOVA["stats"])
    stats["result"] = {"test": "kruskal", "H": 7.3, "df": 2, "p": 0.026, "n": 30,
                       "k": 3, "correction": "holm",
                       "effect": {"name": "epsilon_squared", "value": 0.19},
                       "pairwise": []}
    rows = methods.stats_rows(_analysis("K", stats))
    assert rows[0]["Statistic"] == "H(2) = 7.30"
    assert rows[0]["Effect size"].startswith("ε² = 0.19")


def test_location_one_row_per_tested_lane():
    rows = methods.stats_rows(LOCATION)
    assert len(rows) == 1                        # the n=2 lane is skipped
    assert rows[0]["Comparison"] == "drug_a"
    assert rows[0]["Statistic"] == "t(5) = 3.10"
    assert rows[0]["Effect size"] == "Cohen's dz = 0.90"


def test_rate_global_plus_lanes():
    rows = methods.stats_rows(RATE)
    assert len(rows) == 3                        # global + 2 lanes
    assert rows[0]["Comparison"] == "does group matter"
    assert rows[0]["Statistic"] == "χ²(1) = 4.70"
    assert rows[0]["p"] == "0.030"
    assert rows[1]["Statistic"] == "rate = 0.012 (95% CI 0.008 to 0.018)"
    assert rows[2]["Statistic"] == "rate = 0.025"     # no CI on this lane
    assert rows[1]["Effect size"] == ""               # rate has no effect size


def test_correlation_row():
    r = methods.stats_rows(CORRELATION)[0]
    assert r["Statistic"] == "r = 0.55"
    assert r["Effect size"] == "Pearson r = 0.55 (95% CI 0.31 to 0.72)"


def test_contingency_chi_square_row():
    r = methods.stats_rows(CONTINGENCY)[0]
    assert r["Statistic"] == "χ²(2) = 6.10"
    assert r["Effect size"] == "Cramér's V = 0.22"


def test_fisher_blank_statistic_or_effect():
    r = methods.stats_rows(FISHER)[0]
    assert r["Statistic"] == ""                       # no test statistic
    assert r["Effect size"] == "odds ratio = 3.40 (95% CI 1.20 to 9.60)"


def test_describe_only_yields_no_rows():
    assert methods.stats_rows(DESCRIBE) == []
    assert methods.stats_rows(_analysis("t", {"result": {"test": "none"}})) == []


def test_non_finite_statistic_becomes_dash():
    stats = {"result": {"test": "welch_t", "t": float("nan"), "df": 5, "p": None,
                        "n": 4, "effect": {"name": "hedges_g",
                                           "value": float("nan"), "ci": None}},
             "methods_text": "x"}
    r = methods.stats_rows(_analysis("d", stats))[0]
    assert r["Statistic"] == "t(5) = —"
    assert r["p"] == "—"
    assert r["Effect size"] == ""     # a NaN effect value is dropped, not "= —"


# ── shaping_prose ─────────────────────────────────────────────────────────────

def test_shaping_empty_when_no_reduce_no_spine():
    assert methods.shaping_prose({}) == ""
    assert methods.shaping_prose({"reduce": {"steps": []}, "hierarchy": {"spine": []}}) == ""


def test_shaping_describes_each_reduce_kind():
    spec = {"reduce": {"steps": [
        {"kind": "filter", "conditions": [{"column": "area", "op": ">", "value": 5}]},
        {"kind": "drop", "columns": ["junk"]},
        {"kind": "derive", "column": "ratio", "expr": "a / b"},
        {"kind": "recode", "column": "cond"},
        {"kind": "join", "on": ["date"], "how": "inner"},
        {"kind": "pivot", "column": "channel"},
        {"kind": "grid_complete", "by": ["cell"]},
    ]}}
    out = methods.shaping_prose(spec)
    assert out.startswith("Data were ")
    for frag in ["kept rows where area > 5", "dropped junk", "derived ratio = a / b",
                 "recoded cond", "joined a second table on date",
                 "pivoted channel to columns", "completed a count grid over cell"]:
        assert frag in out


def test_shaping_filter_null_and_membership_and_bound():
    spec = {"reduce": {"steps": [{"kind": "filter", "conditions": [
        {"column": "x", "op": "not-null"},
        {"column": "g", "op": "in", "value": ["a", "b"]},
        {"column": "v", "op": "<=", "bound": "quantile(v, 0.99)"},
    ]}]}}
    out = methods.shaping_prose(spec)
    assert "x is present" in out
    assert "g in [a, b]" in out
    assert "v ≤ quantile(v, 0.99)" in out   # the expression bound, not a scalar


def test_shaping_notes_the_spine():
    out = methods.shaping_prose({"hierarchy": {"spine": ["date", "cell"]}})
    assert "nested by date > cell" in out
    assert "per-replicate summaries" in out


def test_shaping_includes_post_steps():
    spec = {"reduce": {"steps": [], "post": [
        {"kind": "derive", "column": "z", "expr": "sum_a / sum_b"}]}}
    assert "derived z = sum_a / sum_b" in methods.shaping_prose(spec)


# ── software_line ─────────────────────────────────────────────────────────────

def test_software_line_names_present_libraries_only():
    line = methods.software_line(MANIFEST)
    assert "Iris 0.4.0 (commit abc1234)" in line
    assert "scipy 1.13.0" in line and "pingouin 0.5.4" in line
    assert "statsmodels" not in line          # absent from the snapshot → not named
    assert "Python 3.12.1" in line


def test_software_line_flags_a_dirty_build():
    line = methods.software_line({"engine": {"version": "0.4.0", "commit": "z",
                                             "dirty": True}, "engine_snapshot": {}})
    assert "(commit z (modified))" in line


# ── methods_markdown / stats_csv end to end ───────────────────────────────────

def test_markdown_has_a_paragraph_per_analysis_and_a_table():
    md = methods.methods_markdown([WELCH, ANOVA, DESCRIBE], MANIFEST)
    assert md.startswith("# Statistical methods")
    assert "**Fig 1.**" in md and "**Fig 3.**" in md and "**Fig 9.**" in md
    # every analysis's own methods_text is carried verbatim
    assert "Welch's t-test." in md
    assert "One-way ANOVA with Tukey's HSD." in md
    assert "Summarized for n = 50." in md            # describe-only: prose only
    assert "## Statistics table" in md
    assert "| Analysis | Comparison | Test | n | Statistic | p | Effect size |" in md
    # 1 (welch) + 3 (anova omnibus+2) + 0 (describe) = 4 body rows
    body = md.split("## Statistics table")[1]
    assert body.count("| Fig ") == 4
    assert "abc1234" in md


def test_markdown_empty_document():
    md = methods.methods_markdown([], MANIFEST)
    assert "no analyses" in md.lower()
    assert "_No inferential tests were run._" in md


def test_markdown_all_describe_only_notes_no_tests():
    md = methods.methods_markdown([DESCRIBE], MANIFEST)
    assert "**Fig 9.**" in md
    assert "_No inferential tests were run._" in md


def test_csv_round_trips_to_rows():
    text = methods.stats_csv([WELCH, ANOVA])
    reader = list(csv.reader(io.StringIO(text)))
    assert reader[0] == methods.TABLE_COLUMNS
    assert len(reader) == 1 + 4                       # header + welch + 3 anova
    welch = reader[1]
    assert welch[0] == "Fig 1" and welch[2] == "Welch's t-test"
    assert welch[5] == "0.032"


def test_csv_empty_is_header_only():
    text = methods.stats_csv([DESCRIBE])
    reader = list(csv.reader(io.StringIO(text)))
    assert reader == [methods.TABLE_COLUMNS]
