'use client';

import { FormEvent, useMemo, useState } from 'react';
import { buildPromptOutputs, FormValues, PromptOutput, requiredFields } from '@/lib/prompts';

type FieldKey = keyof FormValues;

const initialValues: FormValues = {
  clientName: '',
  clientUrl: '',
  businessType: '',
  knownProducts: '',
  focus: '',
  targetMarket: ''
};

const fieldConfig: Array<{
  key: FieldKey;
  label: string;
  placeholder: string;
  required?: boolean;
  helper?: string;
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
  return nextErrors;
};

const chipStyles =
  'rounded-full bg-slate-800 px-3 py-1 text-xs font-medium text-slate-200 border border-slate-700';

export default function HomePage() {
  const [formValues, setFormValues] = useState<FormValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [status, setStatus] = useState<string>('');
  const [hasValidated, setHasValidated] = useState(false);
  const [pendingValidation, setPendingValidation] = useState(false);
  const [promptOutputs, setPromptOutputs] = useState<PromptOutput[]>([]);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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

    setStatus('All required fields are valid. Prompts refreshed.');
    setPromptOutputs(buildPromptOutputs(formValues));
    setHasGenerated(true);
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
              className="rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-accent/30 transition hover:-translate-y-[1px] hover:shadow-xl hover:shadow-accent/40 focus:outline-none focus:ring-2 focus:ring-accent/60"
            >
              Validate & Generate
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {fieldConfig.map((field) => (
              <div key={field.key} className="flex flex-col gap-2">
                <label className="label" htmlFor={field.key}>
                  {field.label}
                  {field.required && <span className="text-accent"> *</span>}
                </label>
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
            Press "Validate & Generate" to render your tailored prompts. Required fields must be
            complete and valid first.
          </div>
        )}
      </section>
    </main>
  );
}
