# Iris

Iris is an open-source app for turning a table into a figure and a statistical
analysis. It's a graphical interface to the Python libraries scientists already
use for this,[^libs] so the analysis can be done by clicking rather than by
writing code.

An analysis is saved as a single open file, the [`.iris`](./reference/iris-format.md).
It holds your data together with the specification of the analysis: the steps
that shape the table, the plot, and the test. Data, plot and test stay linked.
Edit a value in the input and the change propagates through the shaping steps to
the figure and the statistics.

Because the format is open, a `.iris` can also be written or read by a script,
not only built in the app. That lets two ways of working meet: build an analysis
by hand in the interface, or generate many of them from a script and open each
one to adjust the figure by eye. The same file works both ways.

When you add a statistical test, Iris suggests one based on the structure of your
data and shows how it arrived there; you can take the suggestion or choose
another.

[^libs]: The statistics come from scipy, statsmodels and pingouin; the figures
    from matplotlib.
