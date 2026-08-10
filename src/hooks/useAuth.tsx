import React, { createContext, useContext, useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Session } from "@supabase/supabase-js";

interface AuthContextType {
  session: Session | null;
  isAuthModalOpen: boolean;
  setAuthModalOpen: (open: boolean) => void;
  checkUsageLimit: () => boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthModalOpen, setAuthModalOpen] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (session) {
        setAuthModalOpen(false); // Close modal on successful login
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const checkUsageLimit = () => {
    if (session) return true; // Logged in users have no limit
    
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

  const logout = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ session, isAuthModalOpen, setAuthModalOpen, checkUsageLimit, logout }}
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
