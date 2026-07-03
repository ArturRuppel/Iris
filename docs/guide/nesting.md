# Nested data

Cell-biology data is usually nested: many cells measured within each of a few
biological replicates — subjects, animals, dishes. The cells from one replicate
are not independent of one another, so treating each cell as its own observation
inflates *n* and manufactures significance. This is **pseudoreplication**, and no
choice of test can undo it: a test answers whatever question the rows pose, and
if the rows are wrong the answer is wrong. If your table has one row per thing
measured, this page does not apply to you — skip it.

## The unit of inference

The fix is to test at the replicate grain, not the raw grain: average the cells
within each replicate first, then test across replicates. Iris reads that grain
from the hierarchy you declared in the
[Data view](./data-in.md#describe-the-hierarchy) and collapses to it before
testing. Three cells in each of three subjects is *n = 3*, not *n = 9*.

## Which level to pair at

A paired test is valid only when the two values in a pair come from the same unit
of inference: one subject measured before and after, or one dish split into
treated and untreated halves. That pairing removes between-subject variance and
is the classic, powerful paired design. Because subjects are usually measured
across several sessions, "paired" means *same subject, different time*, not *same
time*.

Pairing on a shared session is a weaker, different claim. Two conditions imaged
on the same day but on *different* samples are independent units that merely
share a batch. The day is then a nuisance block, not the experimental unit:
pairing on it removes only day-to-day variance, and is honest only if each
condition appears once per day and the day genuinely induces correlated noise. It
is not interchangeable with within-subject pairing.

Iris pairs at whatever grain the hierarchy names as the shared unit. Which grain
that is — subject or session — is yours to choose, because the two answer
different questions, and the wrong grain either throws away real pairing power or
invents pairing that is not there.

## SuperPlots: show both grains

A SuperPlot shows both grains at once: every cell as a faint dot, and one bold
dot per replicate, coloured by replicate. Iris composes it as two layers bound to
the hierarchy — a `dot` at the cell level and a `dot` bound to the subject
level — and runs the test on the grain the bold dots sit at.

Here three cells are measured in each of three subjects per group. Because the
bold dots are bound to `subject`, Iris reports *n = 3* per group, not *n = 9* —
read the `n = 9  N = 3` labels under each group. The cell-level spread stays
visible, but pseudoreplication cannot reach the test.

![A SuperPlot: faint cell-level dots behind three bold per-subject dots per group, with n = 9 N = 3 labels showing the test runs at the subject grain](example:superplot-nested/superplot-nested-01)

[Open this example in Iris](iris-open:superplot-nested)

## The same trap in a correlation

Pseudoreplication distorts an association as badly as it distorts a comparison.
Here 20 cells are measured in each of three replicates. Within every replicate
*x* and *y* are strongly **negatively** correlated, but the replicates are
offset, so pooling all 60 cells manufactures a strong **positive** correlation,
ρ = +0.79. Declare the replicate in the hierarchy and Iris computes the
coefficient within each replicate and tests across the three, recovering the
honest negative association: mean ρ = −0.91, *n = 3*. Without the hierarchy,
pooling does not merely inflate *n* — it points the wrong way.

![A scatter where the pooled cloud trends upward but each replicate's own points trend downward, the per-replicate regression lines all negative](example:nested-correlation/nested-correlation-01)

[Open this example in Iris](iris-open:nested-correlation)

## One coefficient per group

Put a categorical column on the colour channel and Iris computes the association
within each group instead of pooling them. This is the textbook Simpson's
paradox: pooled across three iris species, sepal length and width look slightly
**negatively** associated, but within every species the association is clearly
**positive**. Each species gets its own regression line and *r* / *p*, so the
structure the pooled number hides is read straight off the figure.

![Sepal length against width coloured by species: three upward per-species regression lines, against a faint downward trend through the pooled points](example:iris-sepal-stratified/iris-sepal-stratified-01)

[Open this example in Iris](iris-open:iris-sepal-stratified)

---

The nesting spine is a default, not a wall: route a test to a finer grain and
Iris keeps drawing but raises a caution. [Troubleshooting](./troubleshooting.md)
catalogues those cautions; [Reshaping real data](./reshaping.md) collapses messy
inputs down to the replicate end to end.
