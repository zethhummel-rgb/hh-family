import {useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {testEnvironment} from '../config';
import NoticeCard, {type NoticeImage} from '../NoticeCard';
import {isNoticeImagePath, noticeImageBucket, noticeImageExtension, noticeImageMaxBytes} from '../noticeImages';
import type {AdminClient, GetAdminClient} from './api';
import './release-panel.css';

type ReleaseStatus = 'ready' | 'queued' | 'deploying' | 'failed' | 'verified' | 'published';
type DraftFields = {title: string; body: string; image_path: string | null; image_alt: string | null};
type Release = DraftFields & {
  id: string; version: string; commit_sha: string; artifact_run_id: string; artifact_sha256: string;
  status: ReleaseStatus; quiet?: boolean; error: string | null; updated_at: string; created_at: string;
};
type Snapshot = {releases: Release[]; can_release: boolean};
type DispatchAction = 'release' | 'release_quietly' | 'retry_announcement';
type Confirmation = {action: DispatchAction; updatedAt: string};
type LocalImage = {file: File; path: string; url: string};
type Editor = {saved: DraftFields; fields: DraftFields; image?: LocalImage};

const target = testEnvironment ? 'HH TEST' : 'Live HH';
const targetKey = testEnvironment ? 'TEST' : 'LIVE';
const targetHost = testEnvironment ? 'test.hhfamily.ca' : 'app.hhfamily.ca';
const staleDeploymentMs = 60 * 60 * 1000;
const labels: Record<ReleaseStatus, string> = {
  ready: 'Ready', queued: 'Queued', deploying: 'Deploying', failed: 'Failed', verified: 'Deployment verified', published: 'Update posted',
};
const dates = new Intl.DateTimeFormat('en-CA', {dateStyle: 'medium', timeStyle: 'short'});

function releaseFields(release: Release): DraftFields {
  return {title: release.title, body: release.body, image_path: release.image_path, image_alt: release.image_alt};
}

function sameDraft(a: DraftFields, b: DraftFields) {
  return a.title === b.title && a.body === b.body && a.image_path === b.image_path && a.image_alt === b.image_alt;
}

function canPublishDraft(fields: DraftFields) {
  return fields.image_path ? !!fields.image_alt?.trim() : !!(fields.title.trim() && fields.body.trim());
}

async function readSnapshot(client: AdminClient, action: 'snapshot' | 'save_draft', payload: Record<string, unknown> = {}): Promise<Snapshot> {
  const {data, error} = await client.rpc('hh_admin_releases', {action, payload});
  if (error || !Array.isArray(data?.releases) || typeof data.can_release !== 'boolean') {
    throw Error(action === 'snapshot' ? 'Release records could not be loaded.' : 'HH could not confirm the draft was saved. Your changes are still here.');
  }
  return data;
}

async function dispatchReady(getClient: GetAdminClient) {
  try {
    const client = await getClient();
    const {data, error} = await client.functions.invoke('hh-release-dispatch', {body: {action: 'availability'}});
    return !error && data?.dispatch_ready === true && data.target === targetKey;
  } catch {return false;}
}

function runLink(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const link = new URL(value);
    return link.origin === 'https://github.com' && !link.username && !link.password ? link.href : '';
  } catch {return '';}
}

function statusBadge({status, quiet}: Release) {
  return <span className="release-status" data-status={status}>{quiet && status === 'published' ? 'Released quietly' : labels[status]}</span>;
}

export default function ReleasePanel({active, getClient}: {active: boolean; getClient: GetAdminClient}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [selected, setSelected] = useState('');
  const [connected, setConnected] = useState<boolean>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const revision = useRef(0);
  const manualRefresh = useRef(false);

  const acceptSnapshot = useCallback((value: Snapshot) => {
    revision.current++;
    setSnapshot(value);
    setError('');
    setLoading(false);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (quiet && manualRefresh.current) return;
    const request = ++revision.current;
    if (!quiet) {
      manualRefresh.current = true;
      setLoading(true);
    }
    try {
      const client = await getClient();
      const next = await readSnapshot(client, 'snapshot');
      if (request !== revision.current) return;
      setSnapshot(next);
      setError('');
      if (!quiet) {
        const ready = next.can_release && await dispatchReady(getClient);
        if (request === revision.current) setConnected(ready);
      }
    } catch {
      if (request === revision.current) setError('Release records could not be refreshed. Try Refresh.');
    } finally {
      if (!quiet) manualRefresh.current = false;
      if (request === revision.current) setLoading(false);
    }
  }, [getClient]);

  useEffect(() => {
    if (!active) return;
    void refresh();
    return () => {revision.current++;};
  }, [active, refresh]);

  const hasPending = snapshot?.releases.some((release) => ['queued', 'deploying', 'verified'].includes(release.status));
  useEffect(() => {
    if (!active || !hasPending) return;
    const timer = window.setInterval(() => {if (!document.hidden) void refresh(true);}, 5000);
    return () => window.clearInterval(timer);
  }, [active, hasPending, refresh]);

  const release = snapshot?.releases.find((candidate) => candidate.id === selected) ?? snapshot?.releases[0];
  return <div className="release-area">
    {error && <p className="message error" role="alert">{error}</p>}
    <div className="release-layout">
      <section className="panel release-list" aria-labelledby="release-list-heading">
        <div className="record-nav">
          <h2 id="release-list-heading">Builds for {target}</h2>
          <button type="button" disabled={loading} onClick={() => void refresh()}>Refresh</button>
        </div>
        {loading && <p className="release-summary" role="status">Checking release status…</p>}
        {snapshot && !snapshot.releases.length && <p className="release-summary">Approved builds will appear here when release checks pass.</p>}
        {!!snapshot?.releases.length && <ul>
          {snapshot.releases.map((candidate) => <li key={candidate.id}>
            <button type="button" aria-pressed={release?.id === candidate.id} onClick={() => setSelected(candidate.id)}>
              <span><strong>{candidate.version}</strong><code>{candidate.commit_sha.slice(0, 12)}</code></span>
              {statusBadge(candidate)}
            </button>
          </li>)}
        </ul>}
      </section>
      {release && snapshot && <ReleaseEditor key={release.id} release={release} getClient={getClient}
        acceptSnapshot={acceptSnapshot} onRefresh={() => refresh(true)} canRelease={snapshot.can_release} connected={connected} refreshing={loading} />}
    </div>
  </div>;
}

function useSavedArtwork(getClient: GetAdminClient, imagePath: string | null, id: string, alt: string | null, updatedAt: string, enabled: boolean): NoticeImage | undefined {
  const [image, setImage] = useState<{path: string; updatedAt: string; url?: string; state?: 'error'}>();
  const usablePath = isNoticeImagePath(imagePath, id) ? imagePath : null;
  useEffect(() => {
    if (!usablePath || !enabled) return;
    let active = true;
    let url: string | undefined;
    async function load() {
      try {
        const client = await getClient();
        if (!active || !usablePath) return;
        const result = await client.storage.from(noticeImageBucket).download(usablePath);
        if (!active) return;
        if (result.error || !result.data || !result.data.size || result.data.size > noticeImageMaxBytes || !noticeImageExtension(result.data.type)) throw Error('Image unavailable');
        url = URL.createObjectURL(result.data);
        setImage({path: usablePath, updatedAt, url});
      } catch {
        if (active && usablePath) setImage({path: usablePath, updatedAt, state: 'error'});
      }
    }
    void load();
    return () => {active = false;if (url) URL.revokeObjectURL(url);};
  }, [getClient, usablePath, updatedAt, enabled]);
  if (!imagePath || !alt) return undefined;
  if (image?.path === usablePath && image.updatedAt === updatedAt) return {...image, alt};
  return {alt, state: usablePath ? 'loading' : 'error'};
}

type EditorProps = {
  release: Release; getClient: GetAdminClient; acceptSnapshot: (value: Snapshot) => void; onRefresh: () => Promise<void>;
  canRelease: boolean; connected?: boolean; refreshing: boolean;
};

function ReleaseEditor({release, getClient, acceptSnapshot, onRefresh, canRelease, connected, refreshing}: EditorProps) {
  const id = useId();
  const [editor, setEditor] = useState<Editor>(() => {
    const saved = releaseFields(release);
    return {saved, fields: saved};
  });
  const [preview, setPreview] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [workflowUrl, setWorkflowUrl] = useState('');
  const inFlight = useRef(false);
  const localUrl = useRef('');
  const fileRevision = useRef(0);
  const uploaded = useRef<LocalImage | undefined>(undefined);
  const confirmHeading = useRef<HTMLHeadingElement>(null);
  const errorNote = useRef<HTMLParagraphElement>(null);
  const altInput = useRef<HTMLInputElement>(null);

  const {title, body, image_path, image_alt} = release;
  useEffect(() => {
    const saved = {title, body, image_path, image_alt};
    setEditor((previous) => {
      if (sameDraft(previous.saved, saved)) return previous;
      const dirty = !!previous.image || !sameDraft(previous.saved, previous.fields);
      return {saved, fields: dirty ? previous.fields : saved, image: previous.image};
    });
  }, [title, body, image_path, image_alt]);

  useEffect(() => () => {
    fileRevision.current++;
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
  }, []);
  useEffect(() => {if (confirmation) confirmHeading.current?.focus();}, [confirmation]);
  useEffect(() => {if (error) errorNote.current?.focus();}, [error]);

  const {fields, image} = editor;
  const hasImage = !!fields.image_path;
  const dirty = !!image || !sameDraft(fields, editor.saved);
  const editable = release.status === 'ready' || release.status === 'failed';
  const staleDeployment = release.status === 'deploying' && Date.now() - Date.parse(release.updated_at) > staleDeploymentMs;
  const retryingDeployment = release.status === 'queued' || staleDeployment;
  const action = release.status === 'verified' ? 'retry_announcement'
    : editable || retryingDeployment ? 'release' : undefined;
  const canDispatch = canRelease && connected === true;
  const readyToAnnounce = !!action && canDispatch && (!retryingDeployment || !release.quiet) && !dirty && canPublishDraft(release);
  const readyToReleaseQuietly = canDispatch && typeof release.quiet === 'boolean' && action === 'release' && (!retryingDeployment || release.quiet);
  const confirmationCurrent = !!confirmation && confirmation.updatedAt === release.updated_at &&
    (confirmation.action === 'release_quietly' ? readyToReleaseQuietly : readyToAnnounce && confirmation.action === action);
  const confirmingQuiet = confirmation?.action === 'release_quietly';
  const confirmingRetry = confirmation?.action === 'retry_announcement';
  const draftImage = useSavedArtwork(getClient, fields.image_path, release.id, fields.image_alt, release.updated_at, preview && !image);
  useEffect(() => {
    if (confirmation && !confirmationCurrent) setConfirmation(undefined);
  }, [confirmation, confirmationCurrent]);

  function change(fieldsChanged: Partial<DraftFields>) {
    setEditor((previous) => ({...previous, fields: {...previous.fields, ...fieldsChanged}}));
    setMessage('');
  }

  function review(nextAction: DispatchAction) {
    setError('');
    setConfirmation({action: nextAction, updatedAt: release.updated_at});
  }

  function removeImage() {
    if (localUrl.current) URL.revokeObjectURL(localUrl.current);
    localUrl.current = '';
    setEditor((previous) => ({...previous, image: undefined, fields: {...previous.fields, image_path: null, image_alt: null}}));
    setMessage('');
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const extension = noticeImageExtension(file.type);
    if (!extension || !file.size || file.size > noticeImageMaxBytes) {
      setError('Choose a JPEG, PNG, or WebP image up to 5 MB.');
      return;
    }
    const request = ++fileRevision.current;
    const url = URL.createObjectURL(file);
    setError('');
    setCheckingFile(true);
    try {
      const candidate = new Image();
      candidate.src = url;
      await candidate.decode();
      if (request !== fileRevision.current) return;
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      localUrl.current = url;
      const path = `${release.id}/artwork.${extension}`;
      setEditor((previous) => ({...previous, image: {file, path, url}, fields: {...previous.fields, image_path: path, image_alt: ''}}));
      setMessage('');
    } catch {
      if (request === fileRevision.current) setError('HH could not open that image. Choose another file.');
    } finally {
      if (localUrl.current !== url) URL.revokeObjectURL(url);
      if (request === fileRevision.current) setCheckingFile(false);
    }
  }

  async function saveDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editable || inFlight.current || checkingFile || !dirty) return;
    const cleaned = {
      title: fields.title.trim(), body: fields.body.trim(), image_path: fields.image_path,
      image_alt: hasImage ? fields.image_alt?.trim() || null : null,
    };
    if (hasImage && (!cleaned.image_alt || /[\u0000-\u001f\u007f]/.test(cleaned.image_alt))) {
      setError('Enter a short description of the image.');
      altInput.current?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const client = await getClient();
      if (image && uploaded.current !== image) {
        const result = await client.storage.from(noticeImageBucket).upload(image.path, image.file, {
          upsert: true, contentType: image.file.type, cacheControl: '0',
        });
        if (result.error || result.data?.path !== image.path) throw Error('HH could not upload the artwork. Your draft is still here.');
        uploaded.current = image;
      }
      const next = await readSnapshot(client, 'save_draft', {release_id: release.id, ...cleaned});
      const stored = next.releases.find((item) => item.id === release.id);
      if (!stored || !sameDraft(releaseFields(stored), cleaned)) throw Error('HH could not confirm the draft was saved. Your changes are still here.');
      acceptSnapshot(next);
      setEditor({saved: cleaned, fields: cleaned});
      uploaded.current = undefined;
      if (localUrl.current) URL.revokeObjectURL(localUrl.current);
      localUrl.current = '';
      setMessage('Draft saved.');
    } catch (failure) {
      setError(failure instanceof Error && /^HH could not/.test(failure.message) ? failure.message : 'Your changes are still here. Try saving the draft again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function confirm() {
    if (!confirmationCurrent || !confirmation || inFlight.current || refreshing) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const client = await getClient();
      const result = await client.functions.invoke('hh-release-dispatch', {body: {
        action: confirmation.action, release_id: release.id,
        ...(confirmation.action !== 'retry_announcement' ? {expected_updated_at: confirmation.updatedAt} : {}),
      }});
      const response = result.error?.context as Response | undefined;
      if (response?.status === 404 || response?.status === 503) throw Error('Release connection isn’t configured yet. Your saved draft is still available.');
      if (response?.status === 403) throw Error(`Your account is not authorized to perform this action for ${target}.`);
      if (response?.status === 409) throw Error('The release changed while you were reviewing it. Check the latest details and review it again.');
      if (result.error || result.data?.ok !== true) throw Error('HH could not confirm the request. Check the latest release status before trying again.');
      setWorkflowUrl(runLink(result.data.run_url));
      setMessage(confirmingQuiet ? 'Quiet release accepted. Check the status for progress.'
        : confirmingRetry ? 'Announcement retry accepted. Check the status for progress.'
        : 'Release request accepted. Check the status for progress.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'HH could not confirm the request. Check release status before trying again.');
    } finally {
      setConfirmation(undefined);
      await onRefresh();
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="panel release-editor" aria-labelledby={`${id}-release-heading`}>
    <div className="record-nav">
      <h2 id={`${id}-release-heading`}>{release.version} for {target}</h2>
      {statusBadge(release)}
    </div>
    <dl className="release-proof">
      <div><dt>Commit</dt><dd><code>{release.commit_sha}</code></dd></div>
      <div><dt>Build run</dt><dd>{release.artifact_run_id}</dd></div>
      <div><dt>Artifact SHA-256</dt><dd><code>{release.artifact_sha256}</code></dd></div>
      <div><dt>Updated</dt><dd><time dateTime={release.updated_at}>{dates.format(new Date(release.updated_at))}</time></dd></div>
    </dl>
    {release.error && <p className="message error" role="status">{release.error}</p>}
    {message && <p className="message release-message" role="status">{message}</p>}
    {error && <p className="message error" ref={errorNote} tabIndex={-1} role="alert">{error}</p>}
    {workflowUrl && <p className="release-summary"><a href={workflowUrl} target="_blank" rel="noopener noreferrer">Open GitHub run</a></p>}

    <form aria-label="Announcement draft" onSubmit={(event) => void saveDraft(event)}>
      <fieldset className="release-fields" disabled={busy || !editable || !!confirmation}>
        <legend>Announcement draft</legend>
        <label><span>Title {hasImage && <small className="detail">(optional)</small>}</span><input maxLength={100} value={fields.title} onChange={(event) => change({title: event.target.value})} /></label>
        <label><span>Message {hasImage && <small className="detail">(optional)</small>}</span><textarea rows={5} maxLength={2000} value={fields.body} onChange={(event) => change({body: event.target.value})} /></label>
        <div className="notice-artwork">
          <p><strong>Image</strong> <small className="detail">(optional)</small></p>
          <div className="notice-artwork-actions">
            <label className="notice-file-picker">
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={checkingFile} onChange={(event) => void chooseImage(event)} aria-describedby={`${id}-image-formats`} />
              <span>{hasImage ? 'Replace image' : 'Choose image'}</span>
            </label>
            {hasImage && <button type="button" disabled={checkingFile} onClick={removeImage}>Remove image</button>}
          </div>
          <p className="detail" id={`${id}-image-formats`}>JPEG, PNG, or WebP · up to 5 MB</p>
          {checkingFile && <p className="detail" role="status">Checking image…</p>}
          {hasImage && <>
            <p className="detail notice-file-name">{image?.file.name ?? 'Saved image'}</p>
            <label>Image description (alt text)<input ref={altInput} maxLength={300} value={fields.image_alt ?? ''} onChange={(event) => change({image_alt: event.target.value})} /></label>
          </>}
        </div>
        {editable && <div className="inline-actions">
          <button type="submit" disabled={!dirty || checkingFile}>Save draft</button>
        </div>}
      </fieldset>
    </form>

    <div className="inline-actions release-preview-actions">
      <button type="button" aria-expanded={preview} disabled={checkingFile || busy} onClick={() => setPreview((value) => !value)}>{preview ? 'Hide preview' : 'Preview announcement'}</button>
    </div>
    {preview && <div className={`member-notice-preview${hasImage ? ' has-image' : ''}`} aria-label="Announcement preview">
      <NoticeCard kind="update" title={fields.title.trim()} body={fields.body.trim()} releaseVersion={release.version} publishedAt={release.updated_at}
        image={image ? {url: image.url, alt: fields.image_alt?.trim() || 'Draft image'} : draftImage}
        action={<span className="preview-acknowledge">Got it</span>} />
    </div>}

    <div className="release-controls">
      {canRelease && connected === false && <p className="release-summary">Release connection isn’t configured yet. You can still save and preview the draft.</p>}
      {!canRelease && <p className="release-summary">Only authorized release operators can start a deployment or retry an announcement.</p>}
      {editable && canDispatch && (dirty || !canPublishDraft(release)) && <p className="release-summary">Save a draft if you want to announce this release. You can release quietly without one.</p>}
      {release.quiet && ['queued', 'deploying', 'published'].includes(release.status) && <p className="release-summary">Quiet release · No member announcement</p>}
      {release.status === 'verified' && <p className="release-summary">The deployment was verified. The announcement hasn’t been confirmed yet.</p>}
      {!confirmation && (readyToAnnounce || readyToReleaseQuietly) && <div className="inline-actions">
        {action && readyToAnnounce && <button type="button" className="primary" disabled={busy || refreshing} onClick={() => review(action)}>
          {action === 'retry_announcement' ? 'Review announcement retry' : staleDeployment ? 'Review deployment retry' : release.status === 'queued' ? 'Review queued release' : 'Review release'}
        </button>}
        {readyToReleaseQuietly && <button type="button" disabled={busy || refreshing} onClick={() => review('release_quietly')}>
          {retryingDeployment ? 'Review quiet release retry' : 'Quiet release'}
        </button>}
      </div>}
      {confirmationCurrent && confirmation && <section className="release-confirmation" aria-labelledby={`${id}-confirm-heading`}>
        <h3 id={`${id}-confirm-heading`} ref={confirmHeading} tabIndex={-1}>{confirmingQuiet ? `Release ${release.version} quietly to ${target}?` : confirmingRetry ? `Retry the ${release.version} announcement on ${target}?` : `Release ${release.version} to ${target}?`}</h3>
        <p className="release-summary">Target {targetHost} · Commit <code>{release.commit_sha.slice(0, 12)}</code></p>
        <p>{confirmingQuiet ? 'HH will deploy this checked build and record it here. Members will not receive an announcement or notification.' : confirmingRetry ? 'HH will retry the update announcement for this verified build.' : 'HH will deploy this checked build and post the saved update after verifying deployment.'}</p>
        <div className="inline-actions">
          <button type="button" className="primary" disabled={busy || refreshing} onClick={() => void confirm()}>{confirmingQuiet ? 'Confirm quiet release' : confirmingRetry ? 'Retry announcement' : `Release to ${target}`}</button>
          <button type="button" disabled={busy} onClick={() => setConfirmation(undefined)}>Back</button>
        </div>
      </section>}
    </div>
  </section>;
}
