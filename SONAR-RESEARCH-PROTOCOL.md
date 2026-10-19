# WFL SONAR — Research protocol for short-lived regimes

This protocol applies only to Win for Life Classico (WFL), not VinciCasa or other games.

## Objective

Do not search for one permanently valid rule. Preserve each useful result with the time window, regime, target population, source-data cutoff, and uncertainty that made it useful. The goal is to recognize when a similar opportunity returns and to test both inclusion and exclusion/near-outcome strategies.

## Required evidence for every candidate

- Freeze the feature state and prediction before the target draw; no retroactive forecasts.
- Evaluate chronologically with walk-forward development and a separate, untouched OOS period.
- Record sample size, window start/end, data cutoff, mean hits, distribution of 0–5 hits, P(>=2/3/4/5), confidence intervals, baseline and multiple-testing adjustment.
- Mark any OOS segment with fewer than 100 targets as `OOS INSUFFICIENT`; prefer 200+ targets before considering a result for operational use.
- Keep negative, neutral, intermittent and failed results. Never erase a prior validated result just because a later regime differs.
- No strategy is promoted from retrospective discovery alone; require repeated OOS evidence and prospective shadow validation.

## Short windows and regime recurrence

Retain results separately for short rolling windows (including 3, 5, 10, 20, 50 and 100 draws where sample sizes permit), calendar/intraday buckets, sorted positions, and transitions. Record each candidate regime's feature signature and the similarity measure used. When a similar signature returns, compare its result against the historical cases with the same signature and against unconditional/frequency baselines.

## Inclusion, exclusion and near outcomes

For each analog/regime candidate, test distinct hypotheses rather than assuming one direction:
1. **Inclusion:** numbers repeatedly appearing in the successor draws of similar prior states.
2. **Exclusion:** numbers repeatedly absent from those successor draws; test the complementary selection explicitly.
3. **Near outcomes:** successor draws with high overlap or small positional/trajectory distance, scored separately from exact repeats.
4. **Position-conditioned variants:** analyze sorted positions in both directions (position-to-number and number-to-position), with position definitions frozen before evaluation.

Count a historical analog only if its successor occurs strictly before the target. Similarity thresholds, tie-breaking and windows must be fixed on development data before OOS scoring.

## Interpretation

The theoretical expectation for a fixed set of 10 main numbers is 5 hits out of 10. Apparent short-run gains can arise by chance, especially across many windows and thresholds. A result can remain historically valid for a specific regime without being a universal prediction. Report when the regime is absent, too rare, or too weakly supported; do not turn a small retrospective sample into a claim of predictive advantage.
