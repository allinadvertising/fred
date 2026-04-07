import Link from 'next/link';

export default function OnsitesParserPlatformPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10 md:py-12">
      <header className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-10 md:py-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Onsites Parser</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">
            Choose the destination platform.
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Pick the parser that matches where these onsite recommendations need to land. WordPress
            keeps the matched-source workflow. Shopify creates a handle-based SEO export directly
            from the onsite file.
          </p>
        </div>
      </header>

      <section className="grid gap-6 md:grid-cols-2">
        <Link
          href="/onsites-parser/wordpress"
          className="glass group rounded-3xl border-slate-800 px-6 py-7 shadow-soft transition hover:-translate-y-1 hover:border-accent"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Platform 01</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">WordPress</h2>
          <p className="mt-2 text-sm text-slate-300">
            Match onsite URLs against Products, Posts, and Pages exports, then split matched rows
            into plugin-aware CSVs.
          </p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-accent">
            Open WordPress Parser
          </span>
        </Link>

        <Link
          href="/onsites-parser/shopify"
          className="glass group rounded-3xl border-slate-800 px-6 py-7 shadow-soft transition hover:-translate-y-1 hover:border-accent"
        >
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Platform 02</p>
          <h2 className="mt-3 text-2xl font-semibold text-white">Shopify</h2>
          <p className="mt-2 text-sm text-slate-300">
            Use only the onsite export and create a Shopify-ready product CSV with
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">Handle</code>,
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">SEO Title</code>,
            and
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">SEO Description</code>.
            Non-product URLs are split into a separate exclusion file.
          </p>
          <span className="mt-4 inline-flex items-center text-sm font-semibold text-accent">
            Open Shopify Parser
          </span>
        </Link>
      </section>
    </main>
  );
}
