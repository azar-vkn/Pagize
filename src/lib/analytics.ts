import { logEvent } from "firebase/analytics";
import { getAnalyticsSafe } from "@/utils/firebase/client";

/**
 * The set of product events we record. Keeping them in one place makes the
 * schema easy to see and keeps call sites consistent.
 *
 * - tool_opened        a tool page was opened
 * - tool_run           the user started a conversion/action
 * - tool_success       the action finished and produced output
 * - tool_error         the action failed
 * - output_downloaded  the user saved a result file
 */
export type AnalyticsEvent =
  | "tool_opened"
  | "tool_run"
  | "tool_success"
  | "tool_error"
  | "output_downloaded";

type AnalyticsParams = Record<string, string | number | boolean | undefined>;

/**
 * Record a product-analytics event. Provider-agnostic: today it forwards to
 * Google Analytics (GA4) via Firebase, but every call site goes through here,
 * so swapping providers later is a one-file change. Analytics must never break
 * the app, so all failures are swallowed and the call is fire-and-forget.
 */
export function track(event: AnalyticsEvent, params?: AnalyticsParams): void {
  void getAnalyticsSafe()
    .then((analytics) => {
      if (analytics) logEvent(analytics, event, params);
    })
    .catch(() => {
      /* analytics is best-effort; never surface errors to the user */
    });
}

/** Sum the byte sizes of a set of files, for the total_bytes event param. */
export function totalBytes(files: File[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}
