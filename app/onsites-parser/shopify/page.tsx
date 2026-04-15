'use client';

import { FormEvent, useState } from 'react';
import {
  buildShopifyOnsitesOutput,
  type ShopifyOnsitesGeneratedFile,
  type ShopifyOnsitesSummary
} from '@/lib/shopify-onsites';

const fileInputClass =
  'rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-100';

const downloadCsv = (csvText: string, filename: string) => {
  const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
};

const downloadFiles = (files: ShopifyOnsitesGeneratedFile[]) => {
  files.forEach((file) => downloadCsv(file.csvText, file.fileName));
};

export default function ShopifyOnsitesParserPage() {
  const [onsitesFile, setOnsitesFile] = useState<File | null>(null);
  const [bypassH1Update, setBypassH1Update] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [summary, setSummary] = useState<ShopifyOnsitesSummary | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<ShopifyOnsitesGeneratedFile[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');
    setSummary(null);
    setGeneratedFiles([]);

    if (!onsitesFile) {
      setError('Please upload the Onsites CSV.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = buildShopifyOnsitesOutput({
        onsitesCsv: await onsitesFile.text(),
        onsiteFileName: onsitesFile.name,
        bypassH1Update
      });

      downloadFiles(result.files);
      setSummary(result.summary);
      setGeneratedFiles(result.files);
      setStatus(
        `Downloaded ${result.files.length} file(s). ${result.summary.exported} product URLs landed in the Shopify export and ${result.summary.excluded} URLs were excluded.`
      );
    } catch (submissionError) {
      console.error(submissionError);
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Unexpected error while parsing the Shopify CSV.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-10 md:py-12">
      <header className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-10 md:py-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Onsites Parser</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">
            Shopify product onsite export.
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Upload only the onsite CSV. Product URLs under
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">/products/</code>{' '}
            or collection-scoped URLs like
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">
              /collections/.../products/...
            </code>{' '}
            are converted into a Shopify-ready file with
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">Handle</code>,
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">SEO Title</code>,
            and
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">SEO Description</code>.
            Collection product URLs are normalized to their canonical
            <code className="ml-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-xs">
              /products/handle
            </code>{' '}
            path before export. Non-product URLs are sent to a separate exclusion CSV.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          <strong>Could not parse file:</strong>
          <div className="mt-1 text-rose-100/90">{error}</div>
        </div>
      )}

      {status && !error && (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          {status}
        </div>
      )}

      {summary && (
        <div className="grid gap-4 md:grid-cols-4">
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Onsite URLs</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.total}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Exported</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.exported}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Excluded</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.excluded}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Non-Product</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.nonProduct}</div>
          </div>
        </div>
      )}

      {generatedFiles.length > 0 && (
        <section className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-8 md:py-8">
          <div className="flex flex-col gap-2">
            <p className="text-lg font-semibold text-white">Downloads</p>
            <p className="text-sm text-slate-400">
              Automatic downloads were triggered. If your browser blocked any of them, use these
              buttons.
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            {generatedFiles.map((file) => (
              <article
                key={file.fileName}
                className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">{file.label}</p>
                    <p className="mt-1 text-xs text-slate-400">{file.fileName}</p>
                    <p className="mt-2 text-xs text-slate-500">{file.rowCount} row(s)</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => downloadCsv(file.csvText, file.fileName)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:-translate-y-[1px] hover:border-accent hover:text-white"
                  >
                    Download
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-8 md:py-8">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-300">
          <p className="font-semibold text-slate-100">Output format</p>
          <p className="mt-2">
            The Shopify product export always uses
            <code className="ml-1 rounded bg-slate-950 px-1">Handle</code>,
            <code className="ml-1 rounded bg-slate-950 px-1">SEO Title</code>,
            and
            <code className="ml-1 rounded bg-slate-950 px-1">SEO Description</code>.
          </p>
          <p className="mt-2 text-slate-400">
            The <code className="rounded bg-slate-950 px-1">Title</code> column is reserved for the
            onsite H1 and is only included when you turn off the bypass below. Any URL outside
            <code className="ml-1 rounded bg-slate-950 px-1">/products/</code> or
            <code className="ml-1 rounded bg-slate-950 px-1">
              /collections/.../products/...
            </code>{' '}
            goes into a separate exclusion CSV with a short reason. Supported collection URLs are
            cleaned to the canonical
            <code className="ml-1 rounded bg-slate-950 px-1">/products/handle</code> path before
            export.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="label" htmlFor="onsites_csv">
              Onsites CSV
            </label>
            <input
              id="onsites_csv"
              name="onsites_csv"
              type="file"
              accept=".csv"
              className={fileInputClass}
              required
              onChange={(event) => setOnsitesFile(event.target.files?.[0] ?? null)}
            />
            {onsitesFile && <p className="text-xs text-slate-400">Selected: {onsitesFile.name}</p>}
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={bypassH1Update}
              onChange={(event) => setBypassH1Update(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-accent focus:ring-accent"
            />
            Bypass H1 update
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-accent/30 transition hover:-translate-y-[1px] hover:shadow-xl hover:shadow-accent/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? 'Parsing...' : 'Parse & Download'}
          </button>
        </form>
      </section>
    </main>
  );
}
