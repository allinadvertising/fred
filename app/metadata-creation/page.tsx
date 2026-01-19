'use client';

import { FormEvent, useEffect, useState } from 'react';
import { buildSfCsv, findColumn, normalizeUrlForFetch, parseCsvText, type CsvRow } from '@/lib/csv';

type Options = {
  gen_title: boolean;
  gen_desc: boolean;
  gen_h1: boolean;
  clamp_title: boolean;
  clamp_desc: boolean;
};

type EnvCheck = {
  test_mode?: boolean;
  model?: string;
};

type ProgressStage = 'idle' | 'scraping' | 'generating' | 'done';

type ScrapeResult = {
  url: string;
  metaTitle: string;
  metaDescription: string;
  metaH1?: string;
};

const DEFAULT_OPTIONS: Options = {
  gen_title: true,
  gen_desc: true,
  gen_h1: false,
  clamp_title: true,
  clamp_desc: true
};

const getFilename = (headers: Headers) => {
  const header = headers.get('content-disposition');
  if (!header) return 'meta_suggestions.csv';
  const match = header.match(/filename="?([^"]+)"?/i);
  return match?.[1] ?? 'meta_suggestions.csv';
};

const buildKwCsvError = (message: string) => `Could not parse CSV: ${message}`;

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  iterator: (item: T, index: number) => Promise<R>
) => {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await iterator(items[current], current);
    }
  });

  await Promise.all(workers);
  return results;
};

export default function MetadataCreationPage() {
  const [kwFile, setKwFile] = useState<File | null>(null);
  const [brandName, setBrandName] = useState('');
  const [options, setOptions] = useState<Options>(DEFAULT_OPTIONS);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [envCheck, setEnvCheck] = useState<EnvCheck | null>(null);
  const [progressStage, setProgressStage] = useState<ProgressStage>('idle');
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [skipScrape, setSkipScrape] = useState(false);

  useEffect(() => {
    let active = true;
    fetch('/api/env-check')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) setEnvCheck(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const setProgress = (stage: ProgressStage, value: number, message: string) => {
    setProgressStage(stage);
    setProgressValue(value);
    setProgressMessage(message);
  };

  const scrapeUrl = async (url: string) => {
    try {
      const response = await fetch('/api/scrape/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        return { url, metaTitle: '', metaDescription: '', metaH1: '' } satisfies ScrapeResult;
      }

      const data = (await response.json()) as ScrapeResult;
      return {
        url: data.url ?? url,
        metaTitle: data.metaTitle ?? '',
        metaDescription: data.metaDescription ?? '',
        metaH1: data.metaH1 ?? ''
      } satisfies ScrapeResult;
    } catch (err) {
      console.error('Scrape error', err);
      return { url, metaTitle: '', metaDescription: '', metaH1: '' } satisfies ScrapeResult;
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setStatus('');
    setProgress('idle', 0, '');

    if (!kwFile) {
      setError('Please upload the keyword mapping CSV.');
      return;
    }
    if (!brandName.trim()) {
      setError('Please enter the Brand/Name.');
      return;
    }

    setIsSubmitting(true);

    try {
      setProgress('scraping', 5, 'Parsing keyword mapping CSV...');

      const kwCsvText = await kwFile.text();
      const parsed = parseCsvText(kwCsvText);

      if (parsed.errors.length > 0) {
        setProgress('idle', 0, '');
        setError(buildKwCsvError(parsed.errors[0] ?? 'Unknown error.'));
        return;
      }

      const fields = parsed.fields;
      const urlColumn = findColumn(fields, ['URL', 'Address', 'Url', 'url', 'address']);
      const keywordColumn = findColumn(fields, ['Keyword', 'keyword', 'KW', 'Primary Keyword']);

      if (!urlColumn || !keywordColumn) {
        setProgress('idle', 0, '');
        setError('Keyword mapping must include URL (or Address) and Keyword columns.');
        return;
      }

      const kwRows: CsvRow[] = parsed.rows;

      const fetchUrls = kwRows
        .map((row) => normalizeUrlForFetch(row[urlColumn] ?? ''))
        .filter((value) => value);
      const uniqueUrls = Array.from(new Set(fetchUrls));

      if (uniqueUrls.length === 0) {
        setProgress('idle', 0, '');
        setError('No valid URLs found in the keyword mapping CSV.');
        return;
      }

      let sfRows: Array<Record<string, string>>;

      if (skipScrape) {
        setProgress('generating', 40, 'Skipping metadata fetch. Preparing AI request...');
        sfRows = kwRows.map((row) => ({
          Address: row[urlColumn] ?? '',
          'Title 1': '',
          'Meta Description 1': '',
          'H1-1': ''
        }));
      } else {
        setProgress('scraping', 10, `Scraping URLs (0/${uniqueUrls.length})`);
        let completed = 0;
        const scrapeResults = new Map<string, ScrapeResult>();
        const scrapeStart = 10;
        const scrapeEnd = 80;

        await mapWithConcurrency(uniqueUrls, 3, async (url) => {
          const result = await scrapeUrl(url);
          scrapeResults.set(url, result);
          completed += 1;
          const progress =
            scrapeStart + Math.round((completed / uniqueUrls.length) * (scrapeEnd - scrapeStart));
          setProgress('scraping', progress, `Scraping URLs (${completed}/${uniqueUrls.length})`);
        });

        sfRows = kwRows.map((row) => {
          const rawUrl = row[urlColumn] ?? '';
          const fetchUrl = normalizeUrlForFetch(rawUrl);
          const meta = fetchUrl ? scrapeResults.get(fetchUrl) : undefined;

          return {
            Address: rawUrl,
            'Title 1': meta?.metaTitle ?? '',
            'Meta Description 1': meta?.metaDescription ?? '',
            'H1-1': meta?.metaH1 ?? ''
          };
        });
      }

      setProgress('generating', 85, 'Generating metadata with AI...');

      const response = await fetch('/api/metadata?format=csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kw_csv: kwCsvText,
          sf_csv: buildSfCsv(sfRows),
          brand: brandName.trim(),
          ...options
        })
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') ?? '';
        if (contentType.includes('application/json')) {
          const data = await response.json();
          setError(data?.error ?? 'Could not generate metadata.');
        } else {
          setError('Could not generate metadata.');
        }
        setProgress('idle', 0, '');
        return;
      }

      const blob = await response.blob();
      const filename = getFilename(response.headers);
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setStatus('Download ready. Your metadata file has been generated.');
      setProgress('done', 100, 'Download ready. Your metadata file has been generated.');
    } catch (err) {
      console.error(err);
      setError('Unexpected error while generating metadata.');
      setProgress('idle', 0, '');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 px-6 py-10 md:py-12">
      <header className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-10 md:py-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Metadata Creation</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">Metadata Generator</h1>
          <p className="max-w-3xl text-base text-slate-300">
            Upload the keyword mapping CSV, choose what to generate, and download the results as a
            new CSV.
          </p>
        </div>
      </header>

      {envCheck?.test_mode && (
        <div className="glass rounded-2xl border border-slate-800 px-5 py-4 text-sm text-slate-200">
          <strong className="text-white">Test mode:</strong> API calls are skipped. Outputs are mock
          values. Disable by removing <code className="rounded bg-slate-900/70 px-1">META_TEST_MODE</code>{' '}
          or setting it to <code className="rounded bg-slate-900/70 px-1">false</code>.
        </div>
      )}

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-5 py-4 text-sm text-rose-100">
          <strong>Could not generate metadata:</strong>
          <div className="mt-1 text-rose-100/90">{error}</div>
        </div>
      )}

      {status && !error && (
        <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100">
          {status}
        </div>
      )}

      {progressStage !== 'idle' && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-200">
          <div className="flex items-center justify-between text-sm">
            <span>{progressMessage}</span>
            <span className="text-slate-400">{progressValue}%</span>
          </div>
          <div className="mt-3 h-2 w-full rounded-full bg-slate-800">
            <div
              className="h-2 rounded-full bg-accent transition-all"
              style={{ width: `${progressValue}%` }}
            />
          </div>
        </div>
      )}

      <section className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-8 md:py-8">
        <p className="text-sm text-slate-300">
          <span className="font-semibold text-slate-100">Required columns</span>
          <br />
          <span className="text-slate-400">Keyword mapping:</span>{' '}
          <span className="rounded bg-slate-900/70 px-1 text-xs">URL</span>{' '}
          <span className="rounded bg-slate-900/70 px-1 text-xs">Keyword</span>
        </p>
        <p className="mt-3 text-sm text-slate-400">
          We will scrape each URL to capture the current meta title, meta description, and H1 to
          use as context for generation.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <label className="label" htmlFor="brand_name">
              Brand/Name
            </label>
            <input
              id="brand_name"
              name="brand_name"
              type="text"
              value={brandName}
              onChange={(event) => setBrandName(event.target.value)}
              className="input"
              placeholder="All in Advertising"
              required
            />
          </div>

          <div className="flex flex-col gap-2">
            <label className="label" htmlFor="kw_csv">
              Keyword Mapping CSV
            </label>
            <input
              id="kw_csv"
              name="kw_csv"
              type="file"
              accept=".csv"
              className="rounded-xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-200 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-800 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-slate-100"
              required
              onChange={(event) => setKwFile(event.target.files?.[0] ?? null)}
            />
            {kwFile && <p className="text-xs text-slate-400">Selected: {kwFile.name}</p>}
          </div>

          <fieldset className="rounded-2xl border border-slate-800 px-4 py-4">
            <legend className="px-2 text-sm font-semibold text-slate-200">Fields to generate</legend>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-200">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.gen_title}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, gen_title: event.target.checked }))
                  }
                />
                Meta Title
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.gen_desc}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, gen_desc: event.target.checked }))
                  }
                />
                Meta Description
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.gen_h1}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, gen_h1: event.target.checked }))
                  }
                />
                H1
              </label>
            </div>
          </fieldset>

          <fieldset className="rounded-2xl border border-slate-800 px-4 py-4">
            <legend className="px-2 text-sm font-semibold text-slate-200">QA helpers</legend>
            <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-200">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.clamp_title}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, clamp_title: event.target.checked }))
                  }
                />
                Clamp title to 60 chars
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={options.clamp_desc}
                  onChange={(event) =>
                    setOptions((prev) => ({ ...prev, clamp_desc: event.target.checked }))
                  }
                />
                Clamp description to 160 chars
              </label>
            </div>
          </fieldset>

          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={skipScrape}
              onChange={(event) => setSkipScrape(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-accent focus:ring-accent"
            />
            Don&apos;t fetch current metadata
          </label>

          <p className="text-sm text-slate-400">
            We keep current values for any field you do not check.
          </p>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-accent/30 transition hover:-translate-y-[1px] hover:shadow-xl hover:shadow-accent/40 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isSubmitting ? 'Generating...' : 'Generate'}
          </button>
        </form>
      </section>

      <p className="text-sm text-slate-400">
        Tip: If a header name in your keyword CSV differs (for example, url or Url), this tool will
        try to normalize it automatically.
      </p>
    </main>
  );
}
