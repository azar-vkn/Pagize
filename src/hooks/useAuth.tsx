import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { auth } from "@/utils/firebase/client";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import {
  ACTIVITY_WRITE_THROTTLE_MS,
  INACTIVITY_CHECK_INTERVAL_MS,
  clearLastActive,
  isSessionExpiredByInactivity,
  readLastActive,
  writeLastActive,
} from "@/lib/session-activity";

interface AuthContextType {
  /** The signed-in Firebase user, or null when signed out. */
  session: User | null;
  /** True until the stored session has been read. Not the same as signed out. */
  loading: boolean;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  checkUsageLimit: () => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const lastWriteRef = useRef(0);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    writeLastActive(now);
  }, []);

  const logout = useCallback(async () => {
    clearLastActive();
    await signOut(auth);
  }, []);

  // Restore the stored session, dropping it if the user has been away too long.
  // Firebase's onAuthStateChanged fires once on init with the restored user (or
  // null) and again on every subsequent sign-in/sign-out, so a single listener
  // covers both restore and live updates.
  useEffect(() => {
    let active = true;
    let seenFirst = false;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!active) return;

      // On the first emission with a restored user, enforce the inactivity
      // deadline before treating them as signed in.
      if (user && !seenFirst) {
        const lastActive = readLastActive();
        // A missing timestamp means we have never recorded activity for this
        // session (e.g. it predates this feature), so treat it as active now
        // rather than signing a valid user out.
        if (isSessionExpiredByInactivity(lastActive)) {
          seenFirst = true;
          clearLastActive();
          await signOut(auth);
          // signOut triggers another onAuthStateChanged(null) which clears state.
          return;
        }
        markActive(true);
      }

      seenFirst = true;
      setSession(user);
      setLoading(false);

      if (user) {
        setAuthModalOpen(false); // Close modal on successful login
        // onAuthStateChanged only fires on sign-in/out (not token refresh), so
        // any emission carrying a user means fresh activity worth recording.
        markActive(true);
      } else {
        clearLastActive();
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markActive]);

  // While signed in, record activity and enforce the deadline in long-lived tabs.
  useEffect(() => {
    if (!session) return;

    const onActivity = () => markActive();
    const events = ["pointerdown", "keydown", "scroll", "focus"] as const;
    for (const event of events) {
      window.addEventListener(event, onActivity, { passive: true });
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") markActive(true);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const timer = window.setInterval(() => {
      const lastActive = readLastActive();
      if (isSessionExpiredByInactivity(lastActive)) {
        void logout();
      }
    }, INACTIVITY_CHECK_INTERVAL_MS);

    return () => {
      for (const event of events) window.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(timer);
    };
  }, [session, markActive, logout]);

  const checkUsageLimit = () => {
    // Until the stored session has been read we cannot tell a signed-in user
    // from an anonymous one. Allowing the action beats prompting someone who is
    // already signed in to sign in again.
    if (loading || session) return true;

    // Check anonymous usage
    const usageStr = localStorage.getItem("tool_usage_count");
    const usage = usageStr ? parseInt(usageStr, 10) : 0;

    if (usage === 0) {
      // First time use is free
      localStorage.setItem("tool_usage_count", "1");
      return true;
    } else {
      // Over limit, prompt auth
      setAuthModalOpen(true);
      return false;
    }
  };

  const value = useMemo(
    () => ({
      session,
      loading,
      isAuthModalOpen,
      setAuthModalOpen,
      checkUsageLimit,
      logout,
    }),
    // checkUsageLimit closes over loading/session; recreate when those change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, loading, isAuthModalOpen, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
