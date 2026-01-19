'use client';

import { FormEvent, useMemo, useState } from 'react';
import { buildPromptOutputs, FormValues, PromptOutput, requiredFields } from '@/lib/prompts';

type FieldKey = keyof FormValues;

type ProgressStage = 'idle' | 'validating' | 'generating' | 'done';

type UrlStatus = {
  url: string;
  status: number;
};

const normalizeUrlForCheck = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const withScheme = trimmed.startsWith('http') ? trimmed : `http://${trimmed}`;
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.toString();
  } catch {
    return '';
  }
};

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

const getNon200CopyText = (items: Array<{ url: string; status: string }>) => {
  const lines = ['URL,Status Code', ...items.map((item) => `${item.url},${item.status}`)];
  return lines.join('\n');
};

const initialValues: FormValues = {
  clientName: '',
  clientUrl: '',
  businessType: '',
  knownProducts: '',
  focus: '',
  targetMarket: '',
  keywordUrls: ''
};

const fieldConfig: Array<{
  key: FieldKey;
  label: string;
  placeholder: string;
  required?: boolean;
  helper?: string;
  multiline?: boolean;
}> = [
  {
    key: 'clientName',
    label: 'Client name',
    placeholder: 'Acme Corp',
    required: true
  },
  {
    key: 'clientUrl',
    label: 'Client URL (starting point)',
    placeholder: 'https://example.com',
    required: true
  },
  {
    key: 'targetMarket',
    label: 'Target market for Ahrefs extraction',
    placeholder: 'Canada, USA, UK, etc.',
    required: true,
    helper: 'Used in the Ahrefs keyword extraction prompt.'
  },
  {
    key: 'keywordUrls',
    label: 'List of URLs for keyword research',
    placeholder: 'https://example.com/page-1\nhttps://example.com/page-2',
    helper: 'Required. Paste one URL per line; included in the Ahrefs extraction prompt.',
    required: true,
    multiline: true
  },
  {
    key: 'businessType',
    label: 'Business type (optional)',
    placeholder: 'DTC ecommerce, SaaS, marketplace, local service'
  },
  {
    key: 'knownProducts',
    label: 'Known products/services (optional)',
    placeholder: 'List 1-5 items to disambiguate a generic brand name'
  },
  {
    key: 'focus',
    label: 'Focus (optional)',
    placeholder: 'Prioritize B2B wholesale, DTC, subscription, etc.'
  }
];

const isValidUrl = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const validate = (values: FormValues) => {
  const nextErrors: Partial<Record<FieldKey, string>> = {};
  if (!values.clientName.trim()) nextErrors.clientName = 'Client name is required.';
  if (!values.clientUrl.trim()) nextErrors.clientUrl = 'Client URL is required.';
  if (values.clientUrl && !isValidUrl(values.clientUrl)) nextErrors.clientUrl = 'Enter a valid http(s) URL.';
  if (!values.targetMarket.trim()) nextErrors.targetMarket = 'Target market is required.';
  if (!values.keywordUrls.trim()) nextErrors.keywordUrls = 'List of URLs for keyword research is required.';
  return nextErrors;
};

export default function KwrProcessPage() {
  const [formValues, setFormValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [status, setStatus] = useState<string>('');
  const [hasValidated, setHasValidated] = useState(false);
  const [pendingValidation, setPendingValidation] = useState(false);
  const [promptOutputs, setPromptOutputs] = useState<PromptOutput[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [progressStage, setProgressStage] = useState<ProgressStage>('idle');
  const [progressValue, setProgressValue] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [non200Items, setNon200Items] = useState<Array<{ url: string; status: string }>>([]);
  const [showNon200Banner, setShowNon200Banner] = useState(false);
  const [skipUrlChecks, setSkipUrlChecks] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validation = validate(formValues);
    setErrors(validation);
    setHasValidated(true);
    setPendingValidation(false);

    if (Object.keys(validation).length > 0) {
      setStatus('Please fix the highlighted fields before generating prompts.');
      return;
    }

    setStatus('');
    setNon200Items([]);
    setShowNon200Banner(false);
    if (skipUrlChecks) {
      setProgressStage('generating');
      setProgressValue(85);
      setProgressMessage('Building prompts without URL checks...');
      setPromptOutputs(buildPromptOutputs(formValues));
      setHasGenerated(true);
      setProgressStage('done');
      setProgressValue(100);
      setProgressMessage('Prompts ready.');
      setStatus('URL checks skipped. Prompts refreshed.');
      return;
    }

    setProgressStage('validating');
    setProgressValue(5);
    setProgressMessage('Preparing URL validation...');
    setIsValidating(true);

    void (async () => {
      try {
        const rawUrls = formValues.keywordUrls
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);

        const normalizedUrls = rawUrls.map((url) => ({
          raw: url,
          normalized: normalizeUrlForCheck(url)
        }));

        const invalidUrls = normalizedUrls.filter((entry) => !entry.normalized);
        const uniqueUrls = Array.from(
          new Set(normalizedUrls.map((entry) => entry.normalized).filter(Boolean))
        );

        if (uniqueUrls.length === 0) {
          setProgressStage('idle');
          setProgressValue(0);
          setProgressMessage('');
          setStatus('Please provide at least one valid URL.');
          return;
        }

        setProgressMessage(`Validating URLs (0/${uniqueUrls.length})`);
        setProgressValue(10);

        const statusMap = new Map<string, number>();
        let completed = 0;

        await mapWithConcurrency(uniqueUrls, 5, async (url) => {
          try {
            const response = await fetch('/api/url-status/', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url })
            });

            if (response.ok) {
              const data = (await response.json()) as UrlStatus;
              statusMap.set(url, data.status ?? 0);
            } else {
              statusMap.set(url, 0);
            }
          } catch (err) {
            console.error('URL status error', err);
            statusMap.set(url, 0);
          } finally {
            completed += 1;
            const progress = 10 + Math.round((completed / uniqueUrls.length) * 70);
            setProgressValue(progress);
            setProgressMessage(`Validating URLs (${completed}/${uniqueUrls.length})`);
          }
        });

        const non200: Array<{ url: string; status: string }> = invalidUrls.map((entry) => ({
          url: entry.raw,
          status: 'invalid'
        }));

        let okCount = 0;
        let redirectCount = 0;
        let notFoundCount = 0;

        normalizedUrls.forEach((entry) => {
          if (!entry.normalized) return;
          const statusCode = statusMap.get(entry.normalized) ?? 0;
          if (statusCode === 200) okCount += 1;
          else {
            non200.push({
              url: entry.raw,
              status: String(statusCode || 'unknown')
            });
            if (statusCode === 301 || statusCode === 302 || statusCode === 307 || statusCode === 308) {
              redirectCount += 1;
            } else if (statusCode === 404) {
              notFoundCount += 1;
            }
          }
        });

        const validUrls = normalizedUrls
          .filter((entry) => entry.normalized && statusMap.get(entry.normalized) === 200)
          .map((entry) => entry.normalized as string);

        if (non200.length > 0) {
          setNon200Items(non200);
          setShowNon200Banner(true);
        }

        if (validUrls.length === 0) {
          setStatus('No URLs returned status 200. See the validation banner for details.');
          setProgressStage('idle');
          setProgressValue(0);
          setProgressMessage('');
          return;
        }

        setProgressStage('generating');
        setProgressValue(85);
        setProgressMessage('Building prompts with verified URLs...');

        const verifiedValues = {
          ...formValues,
          keywordUrls: validUrls.join('\n')
        };

        setPromptOutputs(buildPromptOutputs(verifiedValues));
        setHasGenerated(true);
        setProgressStage('done');
        setProgressValue(100);
        setProgressMessage('Prompts ready.');
        setStatus(
          `Validated ${uniqueUrls.length} URLs: ${okCount} OK, ${redirectCount} redirects, ${notFoundCount} not found.`
        );
      } finally {
        setIsValidating(false);
      }
    })();
  };

  const missingOptionals = useMemo(
    () =>
      fieldConfig
        .filter((field) => !field.required && !formValues[field.key].trim())
        .map((field) => field.label),
    [formValues]
  );

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1200);
    } catch (error) {
      console.error('Clipboard error', error);
      setStatus('Copy failed. Please copy manually.');
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10 md:py-12">
      <header className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-10 md:py-8">
        <div className="flex flex-col gap-3">
          <p className="text-sm uppercase tracking-[0.25em] text-slate-400">Prompt Workbench</p>
          <h1 className="text-3xl font-semibold text-white md:text-4xl">
            Fill once. Ship three ready-to-use prompts.
          </h1>
          <p className="max-w-3xl text-base text-slate-300">
            Enter your client details, validate required fields, and copy the tailored prompts
            below. Each textbox stays compact with a scroll, and every prompt has a copy button for
            quick handoff to your team.
          </p>
        </div>
      </header>

      <section className="glass rounded-3xl border-slate-800 px-6 py-6 shadow-soft md:px-8 md:py-8">
        {progressStage !== 'idle' && (
          <div className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 px-5 py-4 text-sm text-slate-200">
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-lg font-semibold text-white">Client & Market Form</p>
              <p className="text-sm text-slate-400">
                Required fields must be valid before prompts can be trusted.
              </p>
            </div>
            <button
              type="submit"
              disabled={isValidating}
              className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-accent/30 transition hover:-translate-y-[1px] hover:shadow-xl hover:shadow-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              {isValidating ? 'Validating URLs...' : 'Validate & Generate'}
            </button>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={skipUrlChecks}
              onChange={(event) => setSkipUrlChecks(event.target.checked)}
              className="h-4 w-4 rounded border-slate-600 bg-slate-900 text-accent focus:ring-accent"
            />
            Don&apos;t check URLs status
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            {fieldConfig.map((field) => (
              <div key={field.key} className="flex flex-col gap-2">
                <label className="label" htmlFor={field.key}>
                  {field.label}
                  {field.required && <span className="text-accent"> *</span>}
                </label>
                {field.multiline ? (
                  <textarea
                    id={field.key}
                    className="input min-h-28"
                    placeholder={field.placeholder}
                    value={formValues[field.key]}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setFormValues((prev) => ({ ...prev, [field.key]: nextValue }));
                      if (hasValidated && !pendingValidation) {
                        setPendingValidation(true);
                      }
                    }}
                  />
                ) : (
                  <input
                    id={field.key}
                    className="input"
                    placeholder={field.placeholder}
                    value={formValues[field.key]}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setFormValues((prev) => ({ ...prev, [field.key]: nextValue }));
                      if (hasValidated && !pendingValidation) {
                        setPendingValidation(true);
                      }
                    }}
                  />
                )}
                {field.helper && <p className="text-xs text-slate-400">{field.helper}</p>}
                {errors[field.key] && <p className="error">{errors[field.key]}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 px-4 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-slate-200">Validation</p>
              <span
                className={`rounded-full px-2 py-[2px] text-xs ${
                  pendingValidation || !hasValidated
                    ? 'bg-amber-500/20 text-amber-200'
                    : Object.keys(errors).length === 0
                    ? 'bg-green-500/20 text-green-200'
                    : 'bg-amber-500/20 text-amber-200'
                }`}
              >
                {pendingValidation || !hasValidated
                  ? 'Pending'
                  : Object.keys(errors).length === 0
                  ? 'Ready'
                  : 'Needs attention'}
              </span>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {pendingValidation
                ? 'Changes detected. Validation pending - click Validate & Generate.'
                : status || 'Fill the form and validate.'}
            </p>
            {missingOptionals.length > 0 && (
              <p className="mt-2 text-xs text-slate-400">
                Optional fields left blank: {missingOptionals.join(', ')}.
              </p>
            )}
            <p className="mt-2 text-xs text-slate-400">
              Required: {requiredFields.length} of {fieldConfig.length} fields.
            </p>
          </div>
        </form>
      </section>

      {showNon200Banner && non200Items.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-6 py-10">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900 px-6 py-6 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-white">Non-200 URLs detected</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Copy the list below and fix or exclude these URLs.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNon200Banner(false)}
                className="rounded-lg border border-slate-700 px-3 py-1 text-xs text-slate-200"
              >
                Close
              </button>
            </div>

            <textarea
              readOnly
              value={getNon200CopyText(non200Items)}
              className="mt-4 h-40 w-full rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-xs text-slate-100"
            />

            <div className="mt-4 flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {non200Items.length} URL(s) returned non-200 status.
              </p>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(getNon200CopyText(non200Items))}
                className="rounded-lg bg-accent px-4 py-2 text-xs font-semibold text-slate-950"
              >
                Copy list
              </button>
            </div>
          </div>
        </div>
      )}

      <section className="grid gap-6">
        {hasGenerated ? (
          promptOutputs.map((prompt) => (
            <article
              key={prompt.id}
              className="glass relative overflow-hidden rounded-3xl border-slate-800 px-5 py-5 shadow-soft md:px-7 md:py-6"
            >
              <div className="flex flex-wrap items-start gap-3">
                <div className="flex-1">
                  <h2 className="text-xl font-semibold text-white">{prompt.name}</h2>
                  <p className="text-sm text-slate-400">{prompt.instruction}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy(prompt.id, prompt.content)}
                  className="relative rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:-translate-y-[1px] hover:border-accent hover:text-white focus:outline-none focus:ring-2 focus:ring-accent/60"
                >
                  {copiedId === prompt.id ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="mt-4">
                <textarea
                  readOnly
                  value={prompt.content}
                  className="h-64 w-full resize-none rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm leading-relaxed text-slate-100 shadow-inner outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
            </article>
          ))
        ) : (
          <div className="glass rounded-3xl border border-dashed border-slate-800 px-5 py-6 text-sm text-slate-300 shadow-soft md:px-7">
            Press &quot;Validate &amp; Generate&quot; to render your tailored prompts. Required fields must be
            complete and valid first.
          </div>
        )}
      </section>
    </main>
  );
}
