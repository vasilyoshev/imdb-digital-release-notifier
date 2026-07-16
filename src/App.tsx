import { useQuery } from "@tanstack/react-query";
import { supabase } from "./lib/supabase";

/**
 * Scaffold smoke test: prove the SPA reaches the live self-hosted Supabase.
 * `lists` is RLS-restricted to the authenticated role, so an anonymous client
 * gets a structured response (0 rows, or a permission error) rather than data —
 * either way it confirms connectivity. A thrown fetch (CORS/network) is the only
 * "unreachable" signal. The real dashboard replaces this in the next slices.
 */
function useStackHealth() {
  return useQuery({
    queryKey: ["stack-health"],
    queryFn: async () => {
      const { error, count } = await supabase
        .from("lists")
        .select("*", { count: "exact", head: true });
      return error
        ? { reachable: true, detail: `reached (auth-gated: ${error.message})` }
        : { reachable: true, detail: `reached — ${count ?? 0} lists visible` };
    },
  });
}

export default function App() {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const { data, isLoading, isError, error } = useStackHealth();

  return (
    <div className="min-h-screen bg-base-200 text-base-content">
      <div className="navbar bg-base-100 shadow-sm">
        <div className="flex-1 px-2 text-lg font-semibold">IMDb Notifier</div>
        <div className="flex-none px-2 text-sm opacity-60">Console — scaffold</div>
      </div>

      <main className="mx-auto max-w-2xl p-6">
        <div className="card bg-base-100 shadow">
          <div className="card-body">
            <h2 className="card-title">Backend connection</h2>
            <p className="text-sm opacity-70 break-all">{url}</p>
            {isLoading && <span className="loading loading-dots loading-md" />}
            {isError && (
              <div className="alert alert-error">
                <span>Unreachable: {(error as Error).message}</span>
              </div>
            )}
            {data && (
              <div className="alert alert-success">
                <span>{data.detail}</span>
              </div>
            )}
          </div>
        </div>
        <p className="mt-6 text-center text-sm opacity-50">
          The dashboard, settings, and push land in the following build slices.
        </p>
      </main>
    </div>
  );
}
