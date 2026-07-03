# The .iris file

An analysis is saved as a single open file, the `.iris`. Everything the analysis
needs lives in it: your input tables, the steps that shape them, the test you
settled on, how the figure should look, and a note of where the data came from.
One file can hold several input tables and several analyses over them.

## What it stores, and what it does not

The file stores your data and your choices. It deliberately does not store the
computed output — the numbers, the test results, the rendered figure. Iris
recomputes those from your data and your choices every time the file opens, so
they can never drift out of step with the inputs. Edit a value in the input and
the change propagates through the shaping steps to the figure and the statistics;
there is no stale copy to forget to refresh.

The file also records the exact version of Iris that wrote it, so opening it
later reproduces the same figure and the same numbers. Save and open `.iris`
files from the header; figures export on their own as `.svg`, `.pdf`, or `.png`.

## Open by design

You never have to think about any of this: open a file and Iris shows you the
figure and the statistics. But the format is open, and that buys two things. The
curious can read a file and recompute everything by hand. And a file can be
written by a script instead of assembled in the app, then run without opening
Iris to extract the statistics and render the figure — so a colleague can
reproduce or batch-process your analyses from the command line and get exactly
what you would get by hand.

That is what "data, plot, and test stay linked" means in practice: the link is
the file, and the file is small enough to read.

---

To build one, start at [Get your data in](../data-in.md) and follow the guide
through shaping, plotting, and testing; the [Quickstart](../quickstart.md) is the
fastest full pass.
