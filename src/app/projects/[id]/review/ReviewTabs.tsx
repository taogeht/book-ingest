'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type Doc = {
  id: string;
  filename: string;
  fileType: string;
  status: string;
  pageCount: number | null;
  parseError: string | null;
};
type Unit = {
  id: string;
  unitNumber: number;
  unitTitle: string;
  startPage: number;
  endPage: number;
  confidence: string | null;
  reasoning: string | null;
  reviewed: boolean;
};
type Vocab = {
  id: string;
  unitId: string | null;
  word: string;
  partOfSpeech: string | null;
  multiWord: boolean;
  sourcePage: number | null;
  confidence: string | null;
  reasoning: string | null;
  reviewed: boolean;
  approved: boolean | null;
};

type Tab = 'sources' | 'units' | 'vocab';

export function ReviewTabs({
  projectId,
  docs,
  units,
  vocab,
}: {
  projectId: string;
  docs: Doc[];
  units: Unit[];
  vocab: Vocab[];
}) {
  const [tab, setTab] = useState<Tab>('vocab');
  const [unitFilter, setUnitFilter] = useState<string>('all');
  const router = useRouter();
  const [, startTransition] = useTransition();

  const filteredVocab = useMemo(() => {
    if (unitFilter === 'all') return vocab;
    if (unitFilter === 'unassigned') return vocab.filter((v) => !v.unitId);
    return vocab.filter((v) => v.unitId === unitFilter);
  }, [vocab, unitFilter]);

  async function patchUnit(id: string, body: Partial<Pick<Unit, 'reviewed'>>) {
    const res = await fetch(`/api/projects/${projectId}/units/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  async function patchVocab(id: string, body: Partial<Pick<Vocab, 'approved' | 'reviewed'>>) {
    const res = await fetch(`/api/projects/${projectId}/vocabulary/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) startTransition(() => router.refresh());
  }

  const approvedCount = vocab.filter((v) => v.approved === true).length;
  const rejectedCount = vocab.filter((v) => v.approved === false).length;
  const pendingCount = vocab.length - approvedCount - rejectedCount;

  return (
    <div>
      <div className="mb-4 flex gap-1 border-b border-gray-200">
        <TabBtn active={tab === 'sources'} onClick={() => setTab('sources')}>
          Source documents ({docs.length})
        </TabBtn>
        <TabBtn active={tab === 'units'} onClick={() => setTab('units')}>
          Units ({units.length})
        </TabBtn>
        <TabBtn active={tab === 'vocab'} onClick={() => setTab('vocab')}>
          Vocabulary ({vocab.length})
        </TabBtn>
      </div>

      {tab === 'sources' && (
        <ul className="divide-y rounded border border-gray-200 bg-white text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between px-4 py-3">
              <div>
                <div className="font-medium">{d.filename}</div>
                <div className="text-xs text-gray-500">
                  {d.fileType} · {d.pageCount ?? '?'} pages
                </div>
                {d.parseError && <div className="text-xs text-red-600">{d.parseError}</div>}
              </div>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs uppercase tracking-wide text-gray-600">
                {d.status}
              </span>
            </li>
          ))}
        </ul>
      )}

      {tab === 'units' && (
        <div className="space-y-2">
          {units.length === 0 && <p className="text-sm text-gray-500">No units detected yet.</p>}
          {units.map((u) => (
            <div key={u.id} className="rounded border border-gray-200 bg-white p-4 text-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="font-medium">
                    Unit {u.unitNumber}: {u.unitTitle}
                  </div>
                  <div className="text-xs text-gray-500">
                    Pages {u.startPage}–{u.endPage} · confidence {u.confidence ?? '?'}
                  </div>
                  {u.reasoning && (
                    <p className="mt-2 max-w-2xl text-xs text-gray-600">{u.reasoning}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={u.reviewed}
                      onChange={(e) => patchUnit(u.id, { reviewed: e.target.checked })}
                    />
                    reviewed
                  </label>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === 'vocab' && (
        <div>
          <div className="mb-3 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-wide text-gray-500">Unit:</label>
              <select
                value={unitFilter}
                onChange={(e) => setUnitFilter(e.target.value)}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              >
                <option value="all">All</option>
                <option value="unassigned">Unassigned</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    Unit {u.unitNumber} — {u.unitTitle}
                  </option>
                ))}
              </select>
            </div>
            <div className="text-xs text-gray-600">
              ✓ {approvedCount} approved · ✗ {rejectedCount} rejected · {pendingCount} pending
            </div>
          </div>
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Word</th>
                  <th className="px-3 py-2">POS</th>
                  <th className="px-3 py-2">Multi</th>
                  <th className="px-3 py-2">Page</th>
                  <th className="px-3 py-2">Conf</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filteredVocab.map((v) => (
                  <tr key={v.id} className="align-top">
                    <td className="px-3 py-2 font-medium">{v.word}</td>
                    <td className="px-3 py-2">
                      <PosCell
                        value={v.partOfSpeech ?? ''}
                        onChange={(val) => patchVocab(v.id, { reviewed: true } as any).then(() =>
                          fetch(`/api/projects/${projectId}/vocabulary/${v.id}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ partOfSpeech: val }),
                          }).then(() => router.refresh()),
                        )}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={v.multiWord}
                        onChange={(e) =>
                          fetch(`/api/projects/${projectId}/vocabulary/${v.id}`, {
                            method: 'PATCH',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ multiWord: e.target.checked }),
                          }).then(() => router.refresh())
                        }
                      />
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{v.sourcePage}</td>
                    <td className="px-3 py-2 text-xs text-gray-600">{v.confidence}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => patchVocab(v.id, { approved: true, reviewed: true })}
                          className={`rounded px-2 py-1 text-xs ${v.approved === true ? 'bg-green-600 text-white' : 'bg-gray-100'}`}
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => patchVocab(v.id, { approved: false, reviewed: true })}
                          className={`rounded px-2 py-1 text-xs ${v.approved === false ? 'bg-red-600 text-white' : 'bg-gray-100'}`}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredVocab.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                      No vocabulary in this view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${
        active
          ? 'border-gray-900 font-medium text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-700'
      }`}
    >
      {children}
    </button>
  );
}

function PosCell({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  const options = [
    'noun',
    'verb',
    'adjective',
    'adverb',
    'pronoun',
    'preposition',
    'conjunction',
    'interjection',
    'determiner',
    'phrase',
    'other',
  ];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded border border-gray-200 bg-transparent px-1 py-0.5 text-xs"
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}
