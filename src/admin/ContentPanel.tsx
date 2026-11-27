import {useEffect, useRef, useState, type ChangeEvent, type FormEvent} from 'react';
import {ChevronDown} from 'lucide-react';
import {testEnvironment} from '../config';
import NoticeCard, {noticeHistoryTitle} from '../NoticeCard';
import {noticeImageBucket, noticeImageExtension, noticeImageMaxBytes} from '../noticeImages';
import {SEASONAL_PALETTES, type SeasonalPaletteId} from '../palettes';
import {appReleaseVersion, parseReleaseVersion} from '../releaseVersion';
import type {GetAdminClient} from './api';
import './season-schedules.css';

const themeGroups = [
  {id: 'holiday-themes', title: 'Holiday themes', palettes: ['easter', 'thanksgiving', 'halloween', 'christmas']},
  {id: 'seasonal-colours', title: 'Seasonal colours', palettes: ['spring', 'summer', 'autumn', 'winter']},
] as const;
type Season = SeasonalPaletteId;
type Schedule = {palette: Season; enabled: boolean; starts_on: string | null; stops_on: string | null};
type NoticeKind = 'notice' | 'update';
type Notice = {
  id: string;
  kind: NoticeKind;
  title: string;
  body: string;
  published_at: string;
  archived_at: string | null;
  image_path?: string | null;
  image_alt?: string | null;
  release_version?: string | null;
};
type Contents = {notices: Notice[]; seasonal_palettes: Season[]; palette_schedule?: Schedule[]};
type Artwork = {file: File; extension: NonNullable<ReturnType<typeof noticeImageExtension>>; url: string};
type Draft = {id: string; kind: NoticeKind; title: string; body: string; artwork?: Artwork; alt: string; releaseVersion?: string};
type Action = 'snapshot' | 'publish_notice' | 'archive_notice' | 'set_palette';
const dates = new Intl.DateTimeFormat('en-CA', {dateStyle: 'medium', timeStyle: 'short'});

async function requestContent(getClient: GetAdminClient, action: Action, payload: Record<string, unknown> = {}): Promise<Contents> {
  const adminClient = await getClient();
  const {data, error} = await adminClient.rpc('hh_admin_content', {action, payload});
  if (error || !Array.isArray(data?.notices) || !Array.isArray(data?.seasonal_palettes)) {
    throw Error('HH could not confirm that change. Refresh before trying again.');
  }
  return data;
}

export default function ContentPanel({view, getClient}: {view: 'notices' | 'palettes'; getClient: GetAdminClient}) {
  const [data, setData] = useState<Contents>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [kind, setKind] = useState<NoticeKind>('notice');
  const [releaseVersion, setReleaseVersion] = useState<string>(appReleaseVersion);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [artwork, setArtwork] = useState<Artwork>();
  const [alt, setAlt] = useState('');
  const [checkingImage, setCheckingImage] = useState(false);
  const [preview, setPreview] = useState<Draft>();
  const [archiving, setArchiving] = useState<string>();
  const draft = useRef<Draft | undefined>(undefined);
  const submitting = useRef(false);
  const localImageUrl = useRef<string | undefined>(undefined);
  const imageCheck = useRef(0);
  const uploadedImagePath = useRef<string | undefined>(undefined);
  const uploadInput = useRef<HTMLInputElement>(null);
  const altInput = useRef<HTMLInputElement>(null);
  const releaseInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const bodyInput = useRef<HTMLTextAreaElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const focusPublishError = useRef(false);

  useEffect(() => () => {
    imageCheck.current++;
    if (localImageUrl.current) URL.revokeObjectURL(localImageUrl.current);
  }, []);
  useEffect(() => {
    if (!error || !focusPublishError.current) return;
    focusPublishError.current = false;
    errorMessage.current?.focus();
  }, [error]);

  async function refresh() {
    setBusy(true);
    setError('');
    try {
      setData(await requestContent(getClient, 'snapshot'));
    } catch {
      setError('HH could not load these settings. Try refreshing.');
    } finally {setBusy(false);}
  }
  useEffect(() => {void refresh();}, []);

  async function save(action: Exclude<Action, 'snapshot'>, payload: Record<string, unknown>, success: string, prepare?: () => Promise<void>) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      if (prepare) await prepare();
      try {setData(await requestContent(getClient, action, payload));}
      catch (err) {
        if (action === 'publish_notice') throw Error('HH could not confirm publication. Your draft is still here. Try publishing again.');
        throw err;
      }
      setFeedback(success);
      return true;
    } catch (err) {
      focusPublishError.current = action === 'publish_notice';
      setError(err instanceof Error ? err.message : 'HH could not save the change.');
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  function removeArtwork() {
    if (localImageUrl.current) URL.revokeObjectURL(localImageUrl.current);
    localImageUrl.current = undefined;
    setArtwork(undefined);
    setAlt('');
    setError('');
  }

  async function chooseArtwork(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setFeedback('');
    const extension = noticeImageExtension(file.type);
    if (!extension || !file.size || file.size > noticeImageMaxBytes) {
      setError('Choose a JPEG, PNG, or WebP image up to 5 MB.');
      input.focus();
      return;
    }
    const check = ++imageCheck.current;
    const url = URL.createObjectURL(file);
    setError('');
    setCheckingImage(true);
    try {
      await new Promise<void>((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve();
        candidate.onerror = () => reject(Error('Image could not be decoded'));
        candidate.src = url;
      });
      if (check !== imageCheck.current) return;
      removeArtwork();
      localImageUrl.current = url;
      setArtwork({file, extension, url});
    } catch {
      if (check === imageCheck.current) {
        setError('HH could not open this image. Choose another JPEG, PNG, or WebP file.');
        requestAnimationFrame(() => input.isConnected && input.focus());
      }
    } finally {
      if (localImageUrl.current !== url) URL.revokeObjectURL(url);
      if (check === imageCheck.current) setCheckingImage(false);
    }
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (checkingImage) return;
    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const cleanAlt = artwork ? alt.trim() : '';
    const cleanRelease = kind === 'update' ? parseReleaseVersion(releaseVersion) : undefined;
    if (!cleanTitle && !artwork) {setError('Enter a title.');titleInput.current?.focus();return;}
    if (kind === 'update' && !cleanRelease) {
      setError(`Enter an app version such as ${appReleaseVersion}.`);releaseInput.current?.focus();return;
    }
    if (artwork && (!cleanAlt || /[\u0000-\u001f\u007f]/.test(cleanAlt))) {
      setError('Enter a short description of the image.');altInput.current?.focus();return;
    }
    if (!cleanBody && !artwork) {setError('Enter a message or add an image.');bodyInput.current?.focus();return;}
    setError('');
    setFeedback('');
    const last = draft.current;
    const next = last?.title === cleanTitle && last.body === cleanBody && last.kind === kind && last.artwork === artwork && last.alt === cleanAlt
      && last.releaseVersion === cleanRelease
      ? last : {id: crypto.randomUUID(), kind, title: cleanTitle, body: cleanBody, artwork, alt: cleanAlt, releaseVersion: cleanRelease};
    draft.current = next;
    setPreview(next);
  }

  async function uploadArtwork(image: Artwork, path: string) {
    if (uploadedImagePath.current === path) return;
    try {
      const client = await getClient();
      const {data: uploaded, error: uploadError} = await client.storage.from(noticeImageBucket).upload(path, image.file, {
        upsert: false, contentType: image.file.type, cacheControl: '0',
      });
      if (uploadError) {
        // A retry can find this exact draft object if its first response was lost.
        const code = 'code' in uploadError ? uploadError.code : uploadError.statusCode;
        const duplicate = uploadError.status === 409 || uploadError.statusCode === '409'
          || code === 'Duplicate' || code === 'ResourceAlreadyExists' || code === 'KeyAlreadyExists';
        if (!duplicate) throw uploadError;
      } else if (uploaded?.path !== path) throw Error('Image path mismatch');
      uploadedImagePath.current = path;
    } catch {
      throw Error('HH could not upload the image. Your draft is still here. Try publishing again.');
    }
  }

  async function publish() {
    if (!preview) return;
    const {id, kind, title, body, artwork: image, alt: imageAlt, releaseVersion: version} = preview;
    const imagePath = image ? `${id}/artwork.${image.extension}` : undefined;
    const fields = {
      id, kind, title, body,
      ...(version ? {release_version: version} : {}),
      ...(imagePath ? {image_path: imagePath, image_alt: imageAlt} : {}),
    };
    if (await save('publish_notice', fields, 'Published in HH.', image && imagePath ? () => uploadArtwork(image, imagePath) : undefined)) {
      setPreview(undefined);
      draft.current = undefined;
      uploadedImagePath.current = undefined;
      setTitle('');
      setBody('');
      setReleaseVersion(appReleaseVersion);
      removeArtwork();
    }
  }

  return <>
    <div className="content-feedback">
      {error && <p className="message error" role="alert" ref={errorMessage} tabIndex={-1}>{error}</p>}
      {feedback && <p className="message" role="status">{feedback}</p>}
    </div>
    {!data && <section className="panel">
      {busy ? <p role="status">Loading {view}…</p> : <button type="button" onClick={() => void refresh()}>Refresh</button>}
    </section>}
    {data && view === 'notices' && <div className="workspace content-workspace">
      <section className="panel" aria-labelledby="compose-heading">
        <h2 id="compose-heading">Write a notice</h2>
        <p className="detail content-intro">Published notices open as pop-ups for members in HH.</p>
        {!preview ? <form onSubmit={review}>
          <label><span>Type</span><select aria-label="Notice type" value={kind} onChange={(event) => setKind(event.target.value as NoticeKind)}>
            <option value="notice">Announcement</option><option value="update">App update</option>
          </select></label>
          {kind === 'update' && <div>
            <label>App version
              <input ref={releaseInput} value={releaseVersion} onChange={(event) => setReleaseVersion(event.target.value)}
                placeholder={appReleaseVersion} autoComplete="off" autoCapitalize="characters" spellCheck={false} required aria-describedby="release-version-hint" />
            </label>
            <p className="detail" id="release-version-hint">This version appears with the update’s title.</p>
          </div>}
          <label><span>Title {artwork && <small className="detail">(optional)</small>}</span><input ref={titleInput} value={title} onChange={(event) => setTitle(event.target.value)} maxLength={100} required={!artwork} /></label>
          <label><span>{kind === 'update' ? 'What changed?' : 'Message'} {artwork && <small className="detail">(optional)</small>}</span><textarea ref={bodyInput} value={body} onChange={(event) => setBody(event.target.value)} maxLength={2000} rows={6} required={!artwork} /></label>
          <div className="notice-artwork">
            <p><strong>Image</strong> <small className="detail">(optional)</small></p>
            <div className="notice-artwork-actions">
              <label className="notice-file-picker">
                <input ref={uploadInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || checkingImage} onChange={(event) => void chooseArtwork(event)} aria-describedby="notice-image-formats" />
                <span>{artwork ? 'Replace image' : 'Choose image'}</span>
              </label>
              {artwork && <button type="button" disabled={busy || checkingImage} onClick={() => {removeArtwork();uploadInput.current?.focus();}}>Remove image</button>}
            </div>
            <p className="detail" id="notice-image-formats">JPEG, PNG, or WebP · up to 5 MB</p>
            {checkingImage && <p className="detail" role="status">Checking image…</p>}
            {artwork && <>
              <p className="detail notice-file-name">{artwork.file.name}</p>
              <label>Image description (alt text)<input ref={altInput} value={alt} onChange={(event) => setAlt(event.target.value)} maxLength={300} required aria-describedby="notice-image-description" /></label>
              <p className="detail" id="notice-image-description">Describe the image and include any important text it contains.</p>
            </>}
          </div>
          <button className="primary" disabled={busy || checkingImage}>Preview notice</button>
        </form> : <div className="notice-preview" aria-busy={busy}>
          <div className={`member-notice-preview${preview.artwork ? ' has-image' : ''}`} aria-label="Member preview">
            <NoticeCard kind={preview.kind} title={preview.title} releaseVersion={preview.releaseVersion} body={preview.body} publishedAt={new Date().toISOString()}
              image={preview.artwork ? {url: preview.artwork.url, alt: preview.alt} : undefined}
              action={<span className="preview-acknowledge">Got it</span>} />
          </div>
          <p className="detail">Publish this notice to all {testEnvironment ? 'HH TEST' : 'HH'} households?</p>
          <div className="inline-actions">
            <button type="button" className="primary" disabled={busy} onClick={() => void publish()}>Publish notice</button>
            <button type="button" disabled={busy} onClick={() => setPreview(undefined)}>Keep editing</button>
          </div>
        </div>}
      </section>
      <section className="panel" aria-labelledby="notice-history-heading">
        <div className="record-nav"><h2 id="notice-history-heading">Notice history</h2><button type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button></div>
        {!data.notices.length && <p className="empty">Published notices will appear here.</p>}
        <ul className="record-list notices-history">
          {data.notices.map((row) => {
            const typedTitle = row.title?.trim() ?? '';
            const displayTitle = noticeHistoryTitle(typedTitle, row.image_alt, row.release_version);
            return <li key={row.id}>
              <div className="record-main">
                <strong>{displayTitle}</strong>
                <span className="detail">{row.kind === 'update' ? 'App update' : 'Announcement'} · {dates.format(new Date(row.published_at))}</span>
                {row.body && <p className="request-note">{row.body}</p>}
                {typedTitle && row.image_path && row.image_alt && <p className="detail notice-history-alt">Image · {row.image_alt}</p>}
              </div>
              <div className="record-actions">
                {row.archived_at ? <span className="status expired">Archived</span> : <>
                  {archiving === row.id ? <>
                    <button type="button" disabled={busy} aria-label={`Confirm archive ${displayTitle}`} onClick={async () => {
                      if (await save('archive_notice', {id: row.id}, 'Notice archived.')) setArchiving(undefined);
                    }}>Confirm archive</button>
                    <button type="button" disabled={busy} onClick={() => setArchiving(undefined)}>Cancel</button>
                  </> : <button type="button" disabled={busy} aria-label={`Archive ${displayTitle}`} onClick={() => setArchiving(row.id)}>Archive</button>}
                </>}
              </div>
            </li>;
          })}
        </ul>
      </section>
    </div>}
    {data && view === 'palettes' && <section className="panel theme-schedules-panel" aria-labelledby="theme-availability-heading">
      <header className="theme-schedules-header">
        <div>
          <h2 id="theme-availability-heading">Theme availability</h2>
          <p className="detail">Members choose available themes in Settings → Appearance. Dates take effect at midnight Eastern time.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh()}>Refresh</button>
      </header>
      <ThemeSchedules data={data} busy={busy} onSave={saveSchedule} />
    </section>}
  </>;

  function saveSchedule(schedule: Schedule) {
    if (schedule.starts_on && schedule.stops_on && schedule.stops_on <= schedule.starts_on) {
      setFeedback('');
      setError('Choose a stop date after the start date.');
      return;
    }
    void save('set_palette', schedule, `${SEASONAL_PALETTES[schedule.palette].name} schedule saved.`);
  }
}

const easternDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit'});
const scheduleDate = new Intl.DateTimeFormat('en-CA', {timeZone: 'UTC', dateStyle: 'medium'});
const statusLabels = {off: 'Off', scheduled: 'Scheduled', ended: 'Ended', available: 'Available'};

function ThemeSchedules({data, busy, onSave}: {
  data: Contents; busy: boolean; onSave: (schedule: Schedule) => void;
}) {
  const date = easternDate.formatToParts(new Date());
  const today = ['year', 'month', 'day'].map((part) => date.find((item) => item.type === part)?.value).join('-');
  return <div className="theme-groups">
    {themeGroups.map((group) => <section className="theme-group" key={group.id} aria-labelledby={`${group.id}-heading`}>
      <h3 id={`${group.id}-heading`}>{group.title}</h3>
      <div className="theme-card-grid">
        {group.palettes.map((id) => {
          const palette = SEASONAL_PALETTES[id];
          const row = data.palette_schedule?.find((item) => item.palette === id)
            ?? {palette: id, enabled: data.seasonal_palettes.includes(id), starts_on: null, stops_on: null};
          const status = !row.enabled ? 'off' : row.starts_on && today < row.starts_on ? 'scheduled' : row.stops_on && today >= row.stops_on ? 'ended' : 'available';
          return <details className="theme-schedule-card" data-theme={id} key={id}>
            <summary>
              <span className="theme-card-top">
                <span className="theme-card-swatches" aria-hidden="true">{palette.swatches.map((colour) => <i key={colour} style={{backgroundColor: colour}} />)}</span>
                <span className="theme-card-title"><strong>{palette.name}</strong><small className="detail">{palette.description}</small></span>
                <span className="theme-card-status" data-state={status}>{statusLabels[status]}</span>
                <ChevronDown className="theme-card-chevron" size={16} aria-hidden="true" />
              </span>
              <span className="theme-card-period">
                {row.starts_on && <span>Starts <time dateTime={row.starts_on}>{scheduleDate.format(new Date(`${row.starts_on}T00:00:00Z`))}</time></span>}
                {row.stops_on ? <span>Stops <time dateTime={row.stops_on}>{scheduleDate.format(new Date(`${row.stops_on}T00:00:00Z`))}</time></span>
                  : <span>{row.starts_on ? 'No stop date' : 'No dates set'}</span>}
              </span>
            </summary>
            <form key={`${id}:${row.enabled}:${row.starts_on}:${row.stops_on}`} className="theme-editor" aria-label={`${palette.name} schedule`} onSubmit={(event) => {
              event.preventDefault();
              const input = new FormData(event.currentTarget);
              onSave({palette: id, enabled: input.has('enabled'), starts_on: String(input.get('starts_on') ?? '') || null, stops_on: String(input.get('stops_on') ?? '') || null});
            }}>
              <fieldset disabled={busy}>
                <label className="theme-editor-check"><input type="checkbox" name="enabled" defaultChecked={row.enabled} /> Enable theme</label>
                <div className="theme-editor-dates">
                  <div>
                    <label>Start date<input type="date" name="starts_on" defaultValue={row.starts_on ?? ''} aria-describedby={`${id}-start-help`} /></label>
                    <p className="detail" id={`${id}-start-help`}>Leave blank to start now.</p>
                  </div>
                  <div>
                    <label>Stop date<input type="date" name="stops_on" defaultValue={row.stops_on ?? ''} aria-describedby={`${id}-stop-help`} /></label>
                    <p className="detail" id={`${id}-stop-help`}>Leave blank to keep it available.</p>
                  </div>
                </div>
                <button className="primary" type="submit">Save schedule</button>
              </fieldset>
            </form>
          </details>;
        })}
      </div>
    </section>)}
  </div>;
}
