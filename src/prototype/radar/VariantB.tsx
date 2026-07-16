/**
 * PROTOTYPE (ticket #42) — Variant B "Split hero".
 * A landing page, not a console: big pitch line answering "when does it hit
 * streaming?", region as a pill row under the hero, then a two-column split —
 * released poster cards on the left, a chronological coming-soon timeline on
 * the right with the signup CTA embedded mid-flow.
 */
import { Mark } from "../../components/Mark";
import { bucketFor, daysUntil, fmtFull, fmtShort, REGIONS, type Region } from "./data";
import { Attribution, ProviderChips, RadarPoster } from "./bits";

export const NAME = "Split hero";

export function VariantB({ region, onRegion }: { region: Region; onRegion: (r: Region) => void }) {
  const { recent, upcoming } = bucketFor(region);

  return (
    <div className="flex min-h-screen flex-col bg-base-200 text-base-content">
      <header className="mx-auto w-full max-w-6xl px-4 pt-10 pb-6 text-center">
        <div className="mb-3 flex items-center justify-center gap-2">
          <Mark className="h-7 w-7 text-primary" />
          <span className="wordmark text-3xl">
            RELEASE <span className="text-primary">NOTIFIER</span>
          </span>
        </div>
        <h1 className="mx-auto max-w-2xl text-2xl font-semibold sm:text-4xl">
          When does it hit <span className="text-primary">streaming</span>?
        </h1>
        <p className="mt-2 text-sm opacity-60">
          Digital release dates for the movies everyone's watching — updated daily.
        </p>
        <div className="mt-4 flex justify-center gap-1">
          {REGIONS.map((r) => (
            <button
              key={r}
              className={`btn btn-xs font-mono ${r === region ? "btn-primary" : "btn-ghost border border-base-300"}`}
              onClick={() => onRegion(r)}
            >
              {r}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm absolute top-4 right-4">Sign in →</button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-10">
        <div className="grid gap-8 md:grid-cols-2">
          <section>
            <h2 className="mb-3 font-mono text-sm uppercase tracking-widest text-success">
              ● Just released on digital
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {recent.map((m) => (
                <div key={m.id} className="card border border-base-300 bg-base-100 shadow-sm transition hover:border-primary/50">
                  <figure className="px-3 pt-3">
                    <RadarPoster movie={m} className="w-full" />
                  </figure>
                  <div className="card-body gap-1 p-3">
                    <span className="text-sm leading-tight font-medium">{m.title}</span>
                    <span className="font-mono text-xs text-success">{fmtShort(m.digital[region]!)}</span>
                    <ProviderChips providers={m.providers} max={2} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="mb-3 font-mono text-sm uppercase tracking-widest text-info">
              ◌ Coming to digital
            </h2>
            <ol className="relative ml-3 border-l border-base-300">
              {upcoming.map((m, i) => (
                <li key={m.id} className="mb-5 ml-5">
                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-info" />
                  <div className="flex items-start gap-3">
                    <RadarPoster movie={m} className="w-12 shrink-0" />
                    <div>
                      <span className="font-mono text-xs text-info">
                        {fmtFull(m.digital[region]!)} · in {daysUntil(m.digital[region]!)} days
                      </span>
                      <div className="font-medium">{m.title}</div>
                      <ProviderChips providers={m.providers} max={2} />
                    </div>
                  </div>
                  {i === 2 && (
                    <div className="alert mt-5 border-primary/40 bg-base-100">
                      <div>
                        <div className="font-medium">Waiting on a specific movie?</div>
                        <div className="text-sm opacity-70">
                          Sign up to follow your IMDB watchlist and get pinged the day it drops.
                        </div>
                      </div>
                      <button className="btn btn-primary btn-sm shrink-0 whitespace-nowrap">Sign up free</button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </main>
      <Attribution />
    </div>
  );
}
