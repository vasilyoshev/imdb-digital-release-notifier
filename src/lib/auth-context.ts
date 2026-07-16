import { createContext, useContext } from "react";
import type { Session, User } from "@supabase/supabase-js";

export interface AuthState {
  /** The current Supabase session, or null when signed out. */
  session: Session | null;
  /** Convenience accessor for the signed-in user. */
  user: User | null;
  /** True until the initial session lookup resolves — gate the UI on this. */
  loading: boolean;
  /** Ends the session; the auth listener flips the app back to the login screen. */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | undefined>(undefined);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>.");
  return ctx;
}
