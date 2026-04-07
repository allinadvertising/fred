'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const linkBase =
  'rounded-full border border-slate-700/80 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-200 transition hover:-translate-y-[1px] hover:border-accent hover:text-white';

const linkActive = 'bg-accent text-slate-950 border-accent shadow-lg shadow-accent/30';

export default function TopNav() {
  const pathname = usePathname() ?? '';
  const onKwr = pathname.startsWith('/kwr-process');
  const onMetadata = pathname.startsWith('/metadata-creation');
  const onOnsitesParser = pathname.startsWith('/onsites-parser');

  return (
    <nav className="fixed left-0 right-0 top-0 z-50">
      <div className="glass border-b border-slate-800/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-3 md:py-4">
          <Link
            href="/"
            className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-300 transition hover:text-white"
          >
            Prompt Workbench
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/kwr-process"
              className={`${linkBase} ${onKwr ? linkActive : ''}`}
              aria-current={onKwr ? 'page' : undefined}
            >
              KWR Process
            </Link>
            <Link
              href="/metadata-creation"
              className={`${linkBase} ${onMetadata ? linkActive : ''}`}
              aria-current={onMetadata ? 'page' : undefined}
            >
              Metadata Creation
            </Link>
            <Link
              href="/onsites-parser"
              className={`${linkBase} ${onOnsitesParser ? linkActive : ''}`}
              aria-current={onOnsitesParser ? 'page' : undefined}
            >
              Onsites Parser
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
}
