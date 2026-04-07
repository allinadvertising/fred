import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">
      <header className="glass rounded-3xl border-slate-800 px-6 py-8 shadow-soft md:px-10">
        <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Prompt Workbench</p>
        <h1 className="mt-3 text-3xl font-semibold text-white md:text-4xl">
          Choose your workflow.
        </h1>
        <p className="mt-3 max-w-3xl text-base text-slate-300">
          Jump into the keyword research prompt builder or generate metadata from CSV inputs. Each
          workflow is focused, fast, and ready for production work.
        </p>
      </header>

      <section className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        <Link
          href="/kwr-process"
          className="glass group rounded-3xl border-slate-800 px-6 py-7 shadow-soft transition hover:-translate-y-1 hover:border-accent"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Workflow 01</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">KWR Process</h2>
          <p className="mt-2 text-sm text-slate-300">
            Use the client intake form to generate the three prompt templates for keyword research.
          </p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-accent">
            Open KWR Process
          </span>
        </Link>

        <Link
          href="/metadata-creation"
          className="glass group rounded-3xl border-slate-800 px-6 py-7 shadow-soft transition hover:-translate-y-1 hover:border-accent"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Workflow 02</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Metadata Creation</h2>
          <p className="mt-2 text-sm text-slate-300">
            Upload Screaming Frog + keyword mapping CSVs to generate optimized metadata outputs.
          </p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-accent">
            Open Metadata Creation
          </span>
        </Link>

        <Link
          href="/onsites-parser"
          className="glass group rounded-3xl border-slate-800 px-6 py-7 shadow-soft transition hover:-translate-y-1 hover:border-accent"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Workflow 03</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Onsites Parser</h2>
          <p className="mt-2 text-sm text-slate-300">
            Choose the WordPress or Shopify parser, then turn onsite recommendations into
            platform-ready SEO exports.
          </p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-accent">
            Open Onsites Parser
          </span>
        </Link>
      </section>
    </main>
  );
}
