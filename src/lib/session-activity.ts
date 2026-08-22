/**
 * Inactivity policy for signed-in sessions.
 *
 * Supabase keeps its auth cookies for 400 days and refreshes the access token
 * on its own, so signing in once is enough to stay signed in. This module adds
 * the one rule on top of that: a session that has gone untouched for a week is
 * dropped the next time the app runs.
 *
 * Kept free of React and Supabase imports so the rule can be tested directly.
 */

/** Sign a user out once they have been away this long. */
export const INACTIVITY_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;

/** Upper bound on how often activity is written to localStorage. */
export const ACTIVITY_WRITE_THROTTLE_MS = 60 * 1000;

/** How often an open tab re-checks the inactivity deadline. */
export const INACTIVITY_CHECK_INTERVAL_MS = 5 * 60 * 1000;

export const LAST_ACTIVE_KEY = "pagize.lastActiveAt";

/**
 * Whether a session should be dropped.
 *
 * A null `lastActive` means no activity was ever recorded for this session —
 * it predates this feature, or localStorage was cleared while the auth cookie
 * survived. That is not evidence of inactivity, so the session is kept and the
 * caller stamps a fresh timestamp instead of signing a valid user out.
 */
export function isSessionExpiredByInactivity(
  lastActive: number | null,
  now: number = Date.now(),
  limitMs: number = INACTIVITY_LIMIT_MS,
): boolean {
  if (lastActive === null) return false;
  return now - lastActive > limitMs;
}

/** localStorage throws in private mode and when full; never let that break auth. */
export function readLastActive(): number | null {
  try {
    const raw = localStorage.getItem(LAST_ACTIVE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLastActive(at: number): void {
  try {
    localStorage.setItem(LAST_ACTIVE_KEY, String(at));
  } catch {
    /* ignore */
  }
}

export function clearLastActive(): void {
  try {
    localStorage.removeItem(LAST_ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}
