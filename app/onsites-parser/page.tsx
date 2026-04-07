'use client';

import { FormEvent, useState } from 'react';
import {
  buildOnsitesParserOutput,
  type OnsitesGeneratedFile,
  type OnsitesParserSummary
} from '@/lib/onsites';

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

const downloadFiles = (files: OnsitesGeneratedFile[]) => {
  files.forEach((file) => downloadCsv(file.csvText, file.fileName));
};

const formatSourceList = (sources: OnsitesParserSummary['suggestedSources']) =>
  sources.map((source) => source.charAt(0).toUpperCase() + source.slice(1)).join(', ');

export default function OnsitesParserPage() {
  const [onsitesFile, setOnsitesFile] = useState<File | null>(null);
  const [productsFile, setProductsFile] = useState<File | null>(null);
  const [postsFile, setPostsFile] = useState<File | null>(null);
  const [pagesFile, setPagesFile] = useState<File | null>(null);
  const [bypassH1Update, setBypassH1Update] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [summary, setSummary] = useState<OnsitesParserSummary | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<OnsitesGeneratedFile[]>([]);
  const [showSuggestionModal, setShowSuggestionModal] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');
    setSummary(null);
    setGeneratedFiles([]);
    setShowSuggestionModal(false);

    if (!onsitesFile) {
      setError('Please upload the Onsites CSV.');
      return;
    }

    if (!productsFile && !postsFile && !pagesFile) {
      setError('Upload at least one source CSV: Products, Posts, or Pages.');
      return;
    }

    setIsSubmitting(true);

    try {
      const [onsitesCsv, productsCsv, postsCsv, pagesCsv] = await Promise.all([
        onsitesFile.text(),
        productsFile?.text() ?? Promise.resolve(''),
        postsFile?.text() ?? Promise.resolve(''),
        pagesFile?.text() ?? Promise.resolve('')
      ]);

      const result = buildOnsitesParserOutput({
        onsitesCsv,
        productsCsv: productsCsv || undefined,
        postsCsv: postsCsv || undefined,
        pagesCsv: pagesCsv || undefined,
        bypassH1Update,
        onsiteFileName: onsitesFile.name
      });

      downloadFiles(result.files);
      setGeneratedFiles(result.files);
      setSummary(result.summary);
      setShowSuggestionModal(result.summary.suggestionNeeded);
      setStatus(
        `Downloaded ${result.files.length} file(s). ${result.summary.matched} URLs landed in matched exports and ${result.summary.nonMatched} went to the non-matched file.`
      );
    } catch (submissionError) {
      console.error(submissionError);
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Unexpected error while parsing the CSV files.'
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
            Split onsite recommendations into source-ready exports.
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Upload the non-standard Onsites CSV plus at least one export from Products, Posts, or
            Pages. Matched URLs are split into source-specific CSVs and everything not matched goes
            into a separate non-matched file. SEO fields are mapped against AIOSEO, Yoast, and Rank
            Math style headers automatically.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          <strong>Could not parse files:</strong>
          <div className="mt-1 text-rose-100/90">{error}</div>
        </div>
      )}

      {status && !error && (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          {status}
        </div>
      )}

      {summary && (
        <div className="grid gap-4 md:grid-cols-5">
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">URLs</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.total}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Matched</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.matched}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Non-Matched</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.nonMatched}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Unmatched</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.unmatched}</div>
          </div>
          <div className="glass rounded-2xl border-slate-800 px-5 py-4 text-sm text-slate-300 shadow-soft">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Ambiguous</div>
            <div className="mt-2 text-2xl font-semibold text-white">{summary.ambiguous}</div>
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
          <p className="font-semibold text-slate-100">What this export does</p>
          <p className="mt-2">
            Matched exports only include URLs with <code className="rounded bg-slate-950 px-1">Match Status = matched</code>.
            Each matched file is split by source type and uses the source header names for the
            update fields, including AIOSEO, Yoast, or Rank Math naming when those columns are
            present.
          </p>
          <p className="mt-2 text-slate-400">
            No current metadata values are carried into the matched exports. When H1 bypass stays
            on, the H1 column is omitted entirely from those files.
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

          <div className="grid gap-6 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <label className="label" htmlFor="products_csv">
                Products CSV
              </label>
              <input
                id="products_csv"
                name="products_csv"
                type="file"
                accept=".csv"
                className={fileInputClass}
                onChange={(event) => setProductsFile(event.target.files?.[0] ?? null)}
              />
              {productsFile && <p className="text-xs text-slate-400">Selected: {productsFile.name}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <label className="label" htmlFor="posts_csv">
                Posts CSV
              </label>
              <input
                id="posts_csv"
                name="posts_csv"
                type="file"
                accept=".csv"
                className={fileInputClass}
                onChange={(event) => setPostsFile(event.target.files?.[0] ?? null)}
              />
              {postsFile && <p className="text-xs text-slate-400">Selected: {postsFile.name}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <label className="label" htmlFor="pages_csv">
                Pages CSV
              </label>
              <input
                id="pages_csv"
                name="pages_csv"
                type="file"
                accept=".csv"
                className={fileInputClass}
                onChange={(event) => setPagesFile(event.target.files?.[0] ?? null)}
              />
              {pagesFile && <p className="text-xs text-slate-400">Selected: {pagesFile.name}</p>}
            </div>
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

          <p className="text-sm text-slate-400">
            At least one source file is required. If 30% or more of the URLs do not match, the app
            will prompt you to try additional source exports.
          </p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-accent/30 transition hover:-translate-y-[1px] hover:shadow-xl hover:shadow-accent/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? 'Parsing...' : 'Parse & Download'}
          </button>
        </form>
      </section>

      {showSuggestionModal && summary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 px-6 py-6 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">High non-matched share</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {(summary.nonMatchedRate * 100).toFixed(0)}% of the Onsites URLs did not land in
                  matched exports.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSuggestionModal(false)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200"
              >
                Close
              </button>
            </div>

            <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4 text-sm text-slate-300">
              {summary.suggestedSources.length > 0 ? (
                <p>
                  Consider exporting and uploading the other source files:{' '}
                  <span className="font-semibold text-white">
                    {formatSourceList(summary.suggestedSources)}
                  </span>
                  . That usually reduces the non-matched list.
                </p>
              ) : (
                <p>
                  All three source types are already uploaded. Review the non-matched download to
                  see which URLs still need manual handling.
                </p>
              )}
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setShowSuggestionModal(false)}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-slate-950"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
