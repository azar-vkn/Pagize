import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createClient } from "@/utils/supabase/client";
import type { Session } from "@supabase/supabase-js";
import {
  ACTIVITY_WRITE_THROTTLE_MS,
  INACTIVITY_CHECK_INTERVAL_MS,
  clearLastActive,
  isSessionExpiredByInactivity,
  readLastActive,
  writeLastActive,
} from "@/lib/session-activity";

interface AuthContextType {
  session: Session | null;
  /** True until the stored session has been read. Not the same as signed out. */
  loading: boolean;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  checkUsageLimit: () => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const supabase = useMemo(() => createClient(), []);
  const lastWriteRef = useRef(0);

  const markActive = useCallback((force = false) => {
    const now = Date.now();
    if (!force && now - lastWriteRef.current < ACTIVITY_WRITE_THROTTLE_MS) return;
    lastWriteRef.current = now;
    writeLastActive(now);
  }, []);

  const logout = useCallback(async () => {
    clearLastActive();
    await supabase.auth.signOut();
  }, [supabase]);

  // Restore the stored session, dropping it if the user has been away too long.
  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data: { session: stored } }) => {
      if (!active) return;

      if (stored) {
        const lastActive = readLastActive();
        // A missing timestamp means we have never recorded activity for this
        // session (e.g. it predates this feature), so treat it as active now
        // rather than signing a valid user out.
        if (isSessionExpiredByInactivity(lastActive)) {
          clearLastActive();
          await supabase.auth.signOut();
          if (active) {
            setSession(null);
            setLoading(false);
          }
          return;
        }
        markActive(true);
      }

      setSession(stored);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      setLoading(false);

      if (next) {
        setAuthModalOpen(false); // Close modal on successful login
        if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") markActive(true);
      } else if (event === "SIGNED_OUT") {
        clearLastActive();
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [supabase, markActive]);

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

  return (
    <AuthContext.Provider
      value={{ session, loading, isAuthModalOpen, setAuthModalOpen, checkUsageLimit, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
