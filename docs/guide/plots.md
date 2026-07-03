# Plot types

A plot is one half of the figure. You add it on the Plot half of the figure
node with **+ add plot**, and Iris offers only the plot types your columns can
draw: a plot that needs a group on the x axis and a number on the y axis is
offered when you have a categorical column and a numeric one, and not
otherwise. So the list you see is already filtered to what your data supports.

This page is the catalogue: each plot type, what it shows, and when to reach
for it. Every example is a live figure. Click **Open this example in Iris** to
load the analysis into the app and take it apart; it opens as a new file, so
the original is untouched.

## Comparing a number across groups

The most common figure: one numeric value, split by a categorical group. These
five plots all answer that question and differ in how much of the data they
show. The examples all use the same two groups so you can compare the plots
directly.

### Box plot

The usual first choice. It draws the median, the quartiles, the whiskers, and
any outliers, so you see the centre and spread of each group at a glance.

![](example:iris-species-comparison/iris-species-comparison-01)

[Open this example in Iris](iris-open:iris-species-comparison)

### Violin plot

A violin draws the full shape of each group's distribution. Reach for it when
the shape matters, for example when a group is skewed or has two peaks, which a
box would smooth over.

![](example:iris-species-comparison/iris-species-comparison-02)

[Open this example in Iris](iris-open:iris-species-comparison)

### Dot plot

Every observation as a point. This is the most complete view of a small sample,
because it hides nothing: you see each value and how many there are. This
example also turns on a per-group count label.

![](example:iris-species-comparison/iris-species-comparison-05)

[Open this example in Iris](iris-open:iris-species-comparison)

### Summary (mean and error)

The group mean with an error bar, and nothing else. A clean view when you want
the estimate and its uncertainty without the individual points.

![](example:iris-species-comparison/iris-species-comparison-04)

[Open this example in Iris](iris-open:iris-species-comparison)

### Bar plot

A bar per group, height at the mean, with an error bar. It is familiar, but a
bar shows only one number and hides the distribution behind it. When the sample
is small enough to draw, a box or a dot plot tells the reader more.

![](example:iris-species-comparison/iris-species-comparison-03)

[Open this example in Iris](iris-open:iris-species-comparison)

## Relating two numbers

When both axes are numeric, the question is usually whether the two move
together.

### Scatter and regression

A point per observation, with the two measurements on the two axes. Add a
regression layer for an ordinary-least-squares fit and its confidence band. The
example plots two measurements taken on the same units.

![](example:iris-petal-correlation/iris-petal-correlation-01)

[Open this example in Iris](iris-open:iris-petal-correlation)

## Following a value over an ordered axis

When the x axis is ordered, time, dose, or position, you can trace the value
along it.

### Line

One line per unit, following its value across the ordered axis. Use it to see
individual trajectories. The example draws one line per unit measured at
successive points.

![](example:timeseries-growth/timeseries-growth-01)

[Open this example in Iris](iris-open:timeseries-growth)

### Trend

The average trajectory with a band for the spread, summarising many units into
one curve. Reach for it when the individual lines are too many to read.

![](example:timeseries-growth/timeseries-growth-02)

[Open this example in Iris](iris-open:timeseries-growth)

## Showing one distribution

### Distribution (histogram)

The shape of a single numeric column on its own, with no grouping axis. Use it
to see how one variable is distributed before you compare anything.

![](example:iris-sepal-descriptive/iris-sepal-descriptive-01)

[Open this example in Iris](iris-open:iris-sepal-descriptive)

## Crossing two categories

### Tile (heatmap)

Two categorical columns, one on each axis, with each cell coloured by how many
rows fall into that combination. Use it to read a contingency table as a
picture.

![](example:contingency-2x2/contingency-2x2-01)

[Open this example in Iris](iris-open:contingency-2x2)

---

You can draw more than one plot on the same axes with **+ add layer**, for
example points over a box, or a regression line over a scatter. With a plot in
place, the [Stats half](./test/choosing.md) adds a test, and the plot type you
chose narrows which tests Iris suggests.
