import { Navbar } from "./Navbar";
import { Footer } from "./Footer";

/**
 * The authenticated frame the dashboard, side rail, and settings modal slot
 * into (SPEC §9). For this slice the main region is an intentional empty state
 * — the dashboard content arrives in #32–#34.
 */
export function AppShell() {
  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <Navbar />
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10">
        <div className="grid min-h-[50vh] place-items-center rounded-box border border-dashed border-base-300 bg-base-100/40 p-8 text-center">
          <div className="max-w-sm">
            <p className="wordmark text-3xl text-base-content/70">
              THE SHOW STARTS SOON
            </p>
            <p className="mt-2 text-sm text-base-content/50">
              You&apos;re signed in. The watchlist dashboard, upcoming rail, and
              settings land in the next build slices.
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
