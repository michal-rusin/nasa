// Written with AI assistance (Claude Code and other AI assistants);
// reviewed and tested by the team. NASA Space Apps Challenge 2026.

import type { MetricKey } from '../data/types'
import { METRIC_META } from '../rank/metrics'

/** Whether `a` is strictly better than `b` for the metric (direction from METRIC_META). Missing data = false. */
export function isBetter(k: MetricKey, a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return false
  return METRIC_META[k].direction === 'high' ? a > b : a < b
}
