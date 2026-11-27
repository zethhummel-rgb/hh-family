import {useEffect,useState} from 'react';
import {ChevronDown} from 'lucide-react';
import {authNamespace} from './config';
import MemberPopup from './MemberPopup';
import NoticeCard,{NoticeArtwork,noticeHistoryTitle,type NoticeImage} from './NoticeCard';
import {isNoticeImagePath,noticeImageBucket,noticeImageExtension,noticeImageMaxBytes} from './noticeImages';
import {isSeasonalPalette,type SeasonalPaletteId} from './palettes';
import {isCurrentAuthClient,supabase} from './supabase';
import {appReleaseVersion} from './releaseVersion';

type MemberNotice={id:string;kind:'notice'|'update';title:string;body:string;published_at:string;image_path?:string|null;image_alt?:string|null;release_version?:string|null};
type MemberContent={notices:MemberNotice[];seasons:SeasonalPaletteId[];expiries:Partial<Record<SeasonalPaletteId,number>>;ratingEligible:boolean};
type RatingInput={stars:number;comment:string;allow_quote:boolean};
const emptyContent:MemberContent={notices:[],seasons:[],expiries:{},ratingEligible:false};

function isMemberNotice(value:unknown):value is MemberNotice{
 if(!value||typeof value!=='object')return false;
 const notice=value as Partial<MemberNotice>;
 return typeof notice.id==='string'&&(notice.kind==='notice'||notice.kind==='update')&&typeof notice.title==='string'
  &&typeof notice.body==='string'&&typeof notice.published_at==='string'&&Number.isFinite(Date.parse(notice.published_at));
}

const dismissalKey=(userId:string)=>`${authNamespace}hh:member-notice-dismissals:${userId}`;

function readDismissals(userId:string):string[]{
 try{
  const saved=JSON.parse(localStorage.getItem(dismissalKey(userId))||'[]');
  return Array.isArray(saved)?saved.filter(id=>typeof id==='string'):[];
 }catch{return []}
}

export function useMemberContent(userId:string,enabled:boolean){
 const client=supabase;
 const [snapshot,setSnapshot]=useState<{client:typeof client;userId:string;requestedAt:number;content:MemberContent}|null>(null);
 const [dismissal,setDismissal]=useState(()=>({userId,ids:readDismissals(userId)}));
 const [ratingHold,setRatingHold]=useState<{client:typeof client;userId:string;until:number}>();
 const [themeClock,setThemeClock]=useState(()=>Date.now());
 const dismissed=dismissal.userId===userId?dismissal.ids:readDismissals(userId);
 const content=enabled&&snapshot?.client===client&&snapshot.userId===userId?snapshot.content:emptyContent;
 const ratingOnHold=ratingHold?.client===client&&ratingHold.userId===userId
  &&(snapshot?.requestedAt??0)<ratingHold.until;

 useEffect(()=>{
  if(!enabled)return;
  let active=true,loading=false;
  let boundary:number|undefined;
  async function refresh(){
   setThemeClock(Date.now());
   if(loading||document.hidden||!navigator.onLine||!isCurrentAuthClient(client))return;
   const requestedAt=Date.now();
   loading=true;
   try{
    const {data:auth,error:sessionError}=await client.auth.getSession();
    if(sessionError||auth.session?.user.id!==userId||!active||!isCurrentAuthClient(client))return;
    const {data,error}=await client.rpc('hh_member_content');
    if(error||!active||!isCurrentAuthClient(client))return;
    const notices=Array.isArray(data?.notices)?data.notices.filter(isMemberNotice):[];
    const seasons=Array.isArray(data?.seasonal_palettes)?[...new Set<SeasonalPaletteId>(data.seasonal_palettes.filter(isSeasonalPalette))]:[];
    const expiries:MemberContent['expiries']={};
    for(const id of seasons){
     const end=Date.parse(data?.palette_expiries?.[id]);
     if(Number.isFinite(end))expiries[id]=end;
    }
    setSnapshot({client,userId,requestedAt,content:{notices,seasons,expiries,ratingEligible:data?.rating_eligible===true}});
    window.clearTimeout(boundary);
    const wait=Date.parse(data?.next_palette_change_at)-Date.now();
    if(Number.isFinite(wait)&&wait>0)boundary=window.setTimeout(refresh,Math.min(wait+100,2_000_000_000));
   }catch{/* Notices and seasonal choices are optional when HH is offline or unavailable. */}
   finally{loading=false}
  }
  void refresh();
  const poll=window.setInterval(()=>void refresh(),60_000);
  document.addEventListener('visibilitychange',refresh);
  window.addEventListener('pageshow',refresh);
  window.addEventListener('focus',refresh);
  window.addEventListener('online',refresh);
  return()=>{
   active=false;
   window.clearInterval(poll);
   window.clearTimeout(boundary);
   document.removeEventListener('visibilitychange',refresh);
   window.removeEventListener('pageshow',refresh);
   window.removeEventListener('focus',refresh);
   window.removeEventListener('online',refresh);
  };
 },[client,userId,enabled]);

 useEffect(()=>{
  function sync(event:StorageEvent){
   if(event.key===dismissalKey(userId)||event.key===null)setDismissal({userId,ids:readDismissals(userId)});
  }
  window.addEventListener('storage',sync);
  return()=>window.removeEventListener('storage',sync);
 },[userId]);

 function dismiss(id:string){
  const ids=[...new Set([...readDismissals(userId),...dismissed,id])];
  setDismissal({userId,ids});
  try{localStorage.setItem(dismissalKey(userId),JSON.stringify(ids))}catch{/* Keep the dismissal for this visit. */}
 }

 async function completeRating(input?:RatingInput){
  const {data:auth,error:authError}=await client.auth.getSession();
  if(authError||auth.session?.user.id!==userId||!isCurrentAuthClient(client))throw Error('Open HH and sign in again to continue.');
  const {data,error}=await client.rpc('hh_member_rating',{action:input?'submit':'dismiss',payload:input??{}});
  if(error||data?.completed!==true||!isCurrentAuthClient(client))throw Error('HH could not save your choice. Please try again.');
  const snoozedUntil=Date.parse(data?.snoozed_until);
  setRatingHold({client,userId,until:!input&&Number.isFinite(snoozedUntil)?snoozedUntil:Infinity});
 }

 return {
  notices:content.notices.filter(notice=>!dismissed.includes(notice.id)),
  seasons:content.seasons.filter(id=>themeClock<(content.expiries[id]??Infinity)),
  ratingEligible:content.ratingEligible&&!ratingOnHold,
  dismiss,completeRating,
 };
}

export function MemberNotices({notices,ready,userId,onDismiss}:{notices:MemberNotice[];ready:boolean;userId:string;onDismiss:(id:string)=>void}){
 const [openId,setOpenId]=useState<string>();
 const notice=notices.find(item=>item.id===openId)??notices[0];
 return ready&&notice?<NoticeDialog key={`${userId}:${notice.id}`} userId={userId} notice={notice} onOpen={setOpenId} onDismiss={onDismiss}/>:null;
}

function useNoticeImage(userId:string,notice:MemberNotice):NoticeImage|undefined{
 const client=supabase;
 const path=isNoticeImagePath(notice.image_path,notice.id)?notice.image_path:undefined;
 const alt=typeof notice.image_alt==='string'&&notice.image_alt.trim()?notice.image_alt:notice.title;
 const [result,setResult]=useState<{client:typeof client;path:string;url?:string}>();

 useEffect(()=>{
  if(!path)return;
  const objectPath=path;
  let active=true;
  let url:string|undefined;
  async function load(){
   try{
    const {data:auth,error:authError}=await client.auth.getSession();
    if(!active||!isCurrentAuthClient(client))return;
    if(authError||auth.session?.user.id!==userId)throw Error('Sign-in changed.');
    const {data,error}=await client.storage.from(noticeImageBucket).download(objectPath);
    if(!active||!isCurrentAuthClient(client))return;
    if(error||!data||!noticeImageExtension(data.type)||data.size>noticeImageMaxBytes)throw Error('Could not load announcement image.');
    url=URL.createObjectURL(data);
    setResult({client,path:objectPath,url});
   }catch{
    if(active&&isCurrentAuthClient(client))setResult({client,path:objectPath});
   }
  }
  void load();
  return()=>{
   active=false;
   if(url)URL.revokeObjectURL(url);
  };
 },[client,path,userId]);

 if(!path)return undefined;
 if(result?.client!==client||result.path!==path)return {alt,state:'loading'};
 return result.url?{alt,url:result.url}:{alt,state:'error'};
}

function NoticeDialog({notice,userId,onOpen,onDismiss}:{notice:MemberNotice;userId:string;onOpen:(id:string)=>void;onDismiss:(id:string)=>void}){
 const image=useNoticeImage(userId,notice);
 return <MemberPopup className={image?'has-image':undefined} onOpen={()=>onOpen(notice.id)} onCancel={()=>onDismiss(notice.id)}>
  {({headingId,headingRef})=><NoticeCard kind={notice.kind} title={notice.title} body={notice.body} publishedAt={notice.published_at} releaseVersion={notice.release_version} headingId={headingId} headingRef={headingRef} image={image}
   action={<button className="button primary" type="button" onClick={()=>onDismiss(notice.id)}>Got it</button>}/>}
 </MemberPopup>;
}

const historyDate=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium'});
type HistoryCursor=Pick<MemberNotice,'id'|'published_at'>;

export function MemberNoticeHistory({userId}:{userId:string}){
 const client=supabase;
 const [request,setRequest]=useState<{after?:HistoryCursor}>({});
 const [notices,setNotices]=useState<MemberNotice[]>([]);
 const [hasMore,setHasMore]=useState(false);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');

 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    const {data:auth,error:authError}=await client.auth.getSession();
    if(!active||!isCurrentAuthClient(client))return;
    if(authError||auth.session?.user.id!==userId)throw Error('Sign-in changed.');
    const args=request.after?{before_published_at:request.after.published_at,before_id:request.after.id}:{};
    const {data,error}=await client.rpc('hh_member_notice_history',args);
    if(!active||!isCurrentAuthClient(client))return;
    if(error||!Array.isArray(data?.notices)||!data.notices.every(isMemberNotice))throw Error('History unavailable.');
    const rows:MemberNotice[]=data.notices;
    setNotices(previous=>request.after?[...previous,...rows]:rows);
    setHasMore(data.has_more===true&&rows.length>0);
   }catch{
    if(active&&isCurrentAuthClient(client))setError('Could not load notices. Check your connection and try again.');
   }finally{
    if(active&&isCurrentAuthClient(client))setBusy(false);
   }
  }
  void load();
  return()=>{active=false};
 },[client,request,userId]);

 function getPage(after?:HistoryCursor){
  setBusy(true);
  setError('');
  setRequest({after});
 }
 return <div className="member-notice-history">
  <div className="notice-history-intro">
   <p>Read past announcements and see what changed in HH.</p>
   <p className="notice-current-version">App version on this device <strong>{appReleaseVersion}</strong></p>
  </div>
  {notices.length>0&&<ul aria-label="Published notices and updates">
   {notices.map(notice=><li key={notice.id}><HistoryNotice notice={notice} userId={userId}/></li>)}
  </ul>}
  {busy&&<p className="settings-caption" role="status">{request.after?'Loading earlier posts…':'Loading notices and updates…'}</p>}
  {error&&<>
   <p className="error" role="alert">{error}</p>
   <button className="button soft" type="button" onClick={()=>getPage(request.after)}>Try again</button>
  </>}
  {!busy&&!error&&notices.length===0&&<p className="settings-caption">Announcements and app updates will appear here.</p>}
  {hasMore&&!error&&<button className="button soft" type="button" disabled={busy} onClick={()=>getPage(notices.at(-1))}>Load earlier posts</button>}
 </div>;
}

function HistoryNotice({notice,userId}:{notice:MemberNotice;userId:string}){
 const [expanded,setExpanded]=useState(false);
 return <details className="notice-history-entry" onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>
   <span className="notice-history-heading">
    <span>{notice.kind==='update'?'App update':'Notice'} · <time dateTime={notice.published_at}>{historyDate.format(new Date(notice.published_at))}</time></span>
    <strong>{noticeHistoryTitle(notice.title,notice.image_alt,notice.release_version)}</strong>
   </span>
   <ChevronDown size={18} aria-hidden="true"/>
  </summary>
  {expanded&&<div className="notice-history-content">
   {notice.image_path&&<HistoryArtwork userId={userId} notice={notice}/>}
   {notice.body&&<p>{notice.body}</p>}
  </div>}
 </details>;
}

function HistoryArtwork({notice,userId}:{notice:MemberNotice;userId:string}){
 const image=useNoticeImage(userId,notice);
 return image?<NoticeArtwork image={image}/>:null;
}
