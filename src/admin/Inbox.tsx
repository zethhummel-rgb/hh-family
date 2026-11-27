import {useEffect, useRef, useState} from 'react';
import type {GetAdminClient} from './api';

type Comment = {id: string; message: string; area: string; created_at: string};
type Rating = {id: string; stars: number; comment: string | null; allow_quote: boolean; created_at: string};
type Entry = Comment | Rating;
type Page = {entries: Entry[]; more: boolean; enabled?: boolean};
type Kind = 'all' | 'feedback' | 'ideas';
const date = new Intl.DateTimeFormat('en-CA', {dateStyle: 'medium'});

export default function Inbox({view, getClient}: {view: 'feedback' | 'ratings'; getClient: GetAdminClient}) {
  const [kind, setKind] = useState<Kind>('all');
  const [page, setPage] = useState<Page>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const ratings = view === 'ratings';

  async function read({after, enabled}: {after?: Entry; enabled?: boolean} = {}) {
    const request = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const client = await getClient();
      const cursor = after ? {before_created_at: after.created_at, before_id: after.id} : {};
      const result = ratings
        ? await client.rpc('hh_admin_ratings', enabled === undefined
          ? {action: 'snapshot', payload: cursor}
          : {action: 'set_enabled', payload: {enabled}})
        : await client.rpc('hh_admin_feedback', {kind, ...cursor});
      const entries = ratings ? result.data?.ratings : result.data?.submissions;
      if (result.error || !Array.isArray(entries) || typeof result.data?.has_more !== 'boolean'
        || (ratings && typeof result.data?.enabled !== 'boolean')) throw Error('HH could not load this inbox.');
      if (request !== revision.current) return;
      const {has_more, enabled: promptEnabled} = result.data;
      setPage((previous) => ({entries: after ? [...(previous?.entries ?? []), ...entries] : entries, more: has_more, enabled: promptEnabled}));
    } catch {
      if (request === revision.current) setError('HH could not confirm the change. Refresh and try again.');
    } finally {
      if (request === revision.current) setBusy(false);
    }
  }

  useEffect(() => {
    setPage(undefined);
    void read();
    return () => {revision.current++;};
  }, [kind, view, getClient]);

  return <section className="panel admin-inbox" aria-label={ratings ? 'App ratings' : 'Feedback and ideas'}>
    <div className="record-nav">
      {!ratings ? <div className="record-view" role="group" aria-label="Feedback type">
        {([['all', 'All'], ['feedback', 'Feedback'], ['ideas', 'Ideas']] as const).map(([id, label]) =>
          <button type="button" key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>)}
      </div> : <h2>Rating prompt</h2>}
      <button type="button" disabled={busy} onClick={() => void read()}>Refresh</button>
    </div>
    {ratings && <div className="rating-admin-control">
      <p className="detail">HH can prompt members until they submit a rating. Dismissing pauses the prompt for 24 hours. Members can choose whether HH may quote their comment on the website.</p>
      {page && <button type="button" role="switch" aria-label="Show the rating pop-up" aria-checked={page.enabled === true} disabled={busy}
        onClick={() => void read({enabled: !page.enabled})}>{page.enabled ? 'Prompt on' : 'Prompt off'}</button>}
    </div>}
    {error && <p className="message error" role="alert">{error}</p>}
    {busy && <p className="empty" role="status">Loading…</p>}
    {page && !page.entries.length && !busy && <p className="empty">{ratings ? 'No ratings yet.' : 'No submissions here yet.'}</p>}
    {page && <ul className="record-list inbox-records">
      {page.entries.map((row) => <li key={row.id}><div className="record-main">
        {'stars' in row ? <>
          <strong>{row.stars} / 5 stars</strong>
          <span className="detail">{row.allow_quote ? 'Website quote permitted' : 'Private feedback'}</span>
          {row.comment && <p className="request-note">{row.comment}</p>}
        </> : <>
          <strong>{row.area}</strong><p className="request-note">{row.message}</p>
        </>}
        <time className="detail" dateTime={row.created_at}>{date.format(new Date(row.created_at))}</time>
      </div></li>)}
    </ul>}
    {page?.more && <button type="button" disabled={busy} onClick={() => void read({after: page.entries.at(-1)})}>Load more</button>}
  </section>;
}
