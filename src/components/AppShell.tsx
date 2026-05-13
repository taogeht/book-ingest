import Link from 'next/link';

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link href="/projects" className="font-semibold">
            Curriculum Ingest
          </Link>
          <nav className="flex items-center gap-4 text-sm text-gray-600">
            <Link href="/projects" className="hover:text-gray-900">
              Projects
            </Link>
            <a href="/docs.html" target="_blank" rel="noreferrer" className="hover:text-gray-900">
              Docs
            </a>
            <form action="/api/logout" method="post">
              <button className="hover:text-gray-900" type="submit">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
