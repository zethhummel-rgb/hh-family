import {createGraph,eventFields,eventKey,graphId,ordinaryAppointment,OutlookProblem,type EventFields,type OutlookEvent} from './graph.ts';
import {graphRepeat,outlookOccurrenceDate,type SeriesFields} from './series.ts';
import {expandNativeEvent,localDate,occurrenceForDate,type NativeEvent} from '../google-calendar/native.ts';

type LocalEvent=SeriesFields&{id:string;version:number;recurrence:string[]};
type EventLink={event_id:string;outlook_id:string|null;transaction_id:string;synced_version:number|null;change_key:string|null;retired:boolean;series_state?:string};
type Call=(action:string,payload?:Record<string,unknown>)=>Promise<unknown>;
type Graph=ReturnType<typeof createGraph>;

function remoteVersion(event:OutlookEvent) {
 if(!graphId(event.id)||!event.changeKey)throw new OutlookProblem('retry','Microsoft did not return an event version.');
 return {outlookId:event.id,changeKey:event.changeKey};
}

function instanceDate(event:OutlookEvent) {
 const original=event.originalStart;
 return outlookOccurrenceDate(event.occurrenceId)??(original&&Number.isFinite(Date.parse(original))?localDate(original):null);
}

function seriesKey(fields:SeriesFields) {
 const exceptions=Object.entries(fields.exceptions??{}).sort(([a],[b])=>a.localeCompare(b));
 return JSON.stringify([eventKey(fields),exceptions.map(([date,value])=>[date,value?eventKey(value):null])]);
}

function occurrenceFields(master:LocalEvent,date:string):EventFields|null {
 const change=master.exceptions?.[date];
 if(change===null)return null;
 const source=occurrenceForDate({...master,person:'Everyone'},date);
 if(!source)throw new OutlookProblem('review','A repeating event occurrence needs review.');
 const {title,description,location,starts_at,ends_at,all_day,start_date,end_date}={...source,...change};
 return {title,description,location,starts_at,ends_at,all_day,start_date,end_date};
}

function normalizedLocal(event:LocalEvent):LocalEvent {
 return {...event,exceptions:Object.fromEntries(Object.keys(event.exceptions??{}).map(date=>[date,occurrenceFields(event,date)]))};
}

function carriesMetadata(current:LocalEvent,fields:SeriesFields) {
 const exceptions=Object.fromEntries(Object.entries(fields.exceptions??{}).map(([date,value])=>{
  if(!value)return [date,null];
  const old=current.exceptions?.[date];
  const details={...old,...value};
  if((old?.location??current.location)!==value.location)delete (details as Partial<NativeEvent>).location_place_id;
  return [date,details];
 }));
 return {...fields,exceptions};
}

async function readSeries(graph:Graph,calendarId:string,remote:OutlookEvent) {
 const master=await graph.series(calendarId,remote.id);
 const fields=master&&eventFields(master);
 if(!master||!fields?.recurrence?.length||master['exceptionOccurrences@odata.nextLink'])return null;
 const cancelled=master.cancelledOccurrences??[],modified=master.exceptionOccurrences??[];
 if(cancelled.length+modified.length>200)return null;
 const exceptions:NonNullable<SeriesFields['exceptions']>={},matches=new Map<string,OutlookEvent>();
 for(const id of cancelled) {
  const date=outlookOccurrenceDate(id);
  if(!date||date in exceptions)return null;
  exceptions[date]=null;
 }
 for(const item of modified) {
  const date=instanceDate(item);
  if(!date||date in exceptions||!graphId(item.id))return null;
  const expanded=eventFields(item,true)?item:await graph.event(calendarId,item.id);
  const details=expanded&&eventFields(expanded,true);
  if(!expanded||!details)return null;
  exceptions[date]=details;
  matches.set(date,expanded);
 }
 return {master,fields:{...fields,exceptions},matches};
}

export async function syncEvents(graph:Graph,call:Call,calendarId:string,initial:boolean) {
 const calendar=await graph.calendar(calendarId);
 if(calendar?.id!==calendarId||calendar.canEdit!==true)
  throw new OutlookProblem('reconnect','The selected Outlook calendar is no longer writable.');
 const {events,links,importEvents,syncSince}=await call('snapshot') as {events:LocalEvent[];links:EventLink[];importEvents:boolean;syncSince?:string};
 if(events.length>500)throw new OutlookProblem('review','This household calendar is too large for the trial.');
 const tracked=links.filter(link=>!link.retired);
 // Outlook provides updates only for HH's own copies. Skip reading the
 // remote calendar entirely until there are shared or pending events.
 const remotes=importEvents||tracked.length?await graph.events(calendarId):[];
 const byRemote=new Map(remotes.map(event=>[event.id,event]));
 if(byRemote.size!==remotes.length||remotes.some(event=>!graphId(event.id)))
  throw new OutlookProblem('retry','Microsoft returned an incomplete calendar.');
 const byLocal=new Map(events.map(event=>[event.id,event]));
 const claimedLocal=new Set(links.map(link=>link.event_id));
 const claimedRemote=new Set(links.map(link=>link.outlook_id).filter(Boolean));
 const byTransaction=new Map(remotes.filter(event=>event.transactionId).map(event=>[event.transactionId,event]));
 for(const link of links) {
  const previouslySent=byTransaction.get(link.transaction_id);
  if(previouslySent)claimedRemote.add(previouslySent.id);
 }
 let review=false;

 for(const link of tracked) {
  const remote=link.outlook_id?byRemote.get(link.outlook_id):byTransaction.get(link.transaction_id);
  const local=byLocal.get(link.event_id);
  const eventId=link.event_id;
  const version=local?.version??null;
  if(!link.outlook_id&&remote) {
   // A previous create may have completed after the HTTP response was lost.
   await call('remember',{eventId,version:link.synced_version,...remoteVersion(remote)});
  }
  if(!remote) {
   if(!link.outlook_id) {
    if(local)await sendNew(local,link.transaction_id);
    if(!local)await call('retire',{eventId});
    continue;
   }
   if(await graph.exists(link.outlook_id)){
    if(!local)console.warn('Outlook calendar deletion held: copy moved out of the selected calendar');
    review=true;continue;
   }
   if(!local){await call('retire',{eventId});continue}
   if(version!==link.synced_version){review=true;continue}
   await call('remove',{eventId,version,outlookId:link.outlook_id});
   continue;
  }
  if(remote.type==='seriesMaster'||local?.recurrence.length) {
   if(!await syncSeries(remote,local,link))review=true;
   continue;
  }
  if(!local) {
   // Deleting a known copy needs its unchanged Outlook version and calendar,
   // but does not require being able to convert its event notes to HH text.
   if(remote.type!=='singleInstance'||!ordinaryAppointment(remote)||!link.change_key||remote.changeKey!==link.change_key){
    console.warn('Outlook calendar deletion held: copy changed or is no longer an ordinary appointment');
    review=true;continue;
   }
   const current=await graph.event(calendarId,remote.id);
   if(!current||current.id!==remote.id||current.type!=='singleInstance'||!ordinaryAppointment(current)||
    current.changeKey!==link.change_key||!current['@odata.etag']){
    console.warn('Outlook calendar deletion held: unable to confirm the same appointment version');
    review=true;continue;
   }
   if(!await call('current',{eventId,version:null}))continue;
   if(!await graph.remove(calendarId,remote.id,current['@odata.etag']))
    throw new OutlookProblem('retry','Outlook did not confirm the event was removed.');
   await call('retire',{eventId});
   continue;
  }
  const fields=eventFields(remote);
  if(!fields){review=true;continue}
  const remoteVersionFields=remoteVersion(remote);
  if(version!==link.synced_version) {
   if(eventKey(local)===eventKey(fields)) {
    await call('remember',{eventId,version,...remoteVersionFields});
    continue;
   }
   // Concurrent edits or deletes need review before either side overwrites
   // newer data. An unknown change key is allowed only for recovered creates.
   if(link.change_key&&remote.changeKey!==link.change_key){review=true;continue}
   const current=await graph.event(calendarId,remote.id);
   const currentFields=current&&eventFields(current);
   if(!current||current.changeKey!==remote.changeKey||!currentFields||!current['@odata.etag']){
    review=true;continue;
   }
   if(!await call('current',{eventId,version}))continue;
   const updated=await graph.update(calendarId,remote.id,local,currentFields,current['@odata.etag']);
   if(!updated||updated.id!==remote.id)throw new OutlookProblem('retry','Outlook did not confirm the event change.');
   await call('remember',{eventId,version,...remoteVersion(updated)});
  }else if(link.change_key!==remote.changeKey) {
   if(eventKey(local)===eventKey(fields))await call('remember',{eventId,version,...remoteVersionFields});
   else await call('receive',{eventId,version,event:fields,...remoteVersionFields});
  }
 }

 const unshared=events.filter(local=>!claimedLocal.has(local.id)&&(!local.recurrence.length||!syncSince||
  expandNativeEvent({...local,person:'Everyone'} as NativeEvent,syncSince,'9999-01-01T00:00:00Z',1,true).length));
 if(importEvents) {
  const unpaired=remotes.flatMap(remote=>{
   const fields=claimedRemote.has(remote.id)?null:eventFields(remote);
   return fields?[{remote,fields,key:eventKey(fields)}]:[];
  });
  for(const {remote,fields,key} of unpaired) {
   const series=fields.recurrence?.length?await readSeries(graph,calendarId,remote):null;
   if(fields.recurrence?.length&&!series){review=true;continue}
   const entry=series?.fields??fields;
   const exact=initial?unshared.filter(local=>eventKey(local)===key):[];
   if(exact.length) {
    for(const local of exact)claimedLocal.add(local.id);
    if(exact.length===1&&unpaired.filter(item=>item.key===key).length===1) {
     const {id:eventId,version}=exact[0];
     if(series&&seriesKey(entry)!==seriesKey(normalizedLocal(exact[0]))){review=true;continue}
     await call('match',{eventId,version,...remoteVersion(series?.master??remote),...(series?{seriesState:seriesKey(entry)}:{})});
    }else review=true;
   }else await call('receive',{event:entry,...remoteVersion(series?.master??remote),...(series?{seriesState:seriesKey(entry)}:{})});
  }
 }
 for(const local of unshared)if(!claimedLocal.has(local.id)) {
  const transactionId=await call('reserve',{eventId:local.id,version:local.version});
  if(typeof transactionId==='string')await sendNew(local,transactionId);
 }
 return review?'review':null;

 async function sendNew(local:LocalEvent,transactionId:string) {
  if(local.recurrence.length&&!graphRepeat(local)){review=true;return}
  if(!await call('current',{eventId:local.id,version:local.version}))return;
  const remote=await graph.create(calendarId,local,transactionId);
  if(!remote)throw new OutlookProblem('retry','Outlook did not confirm the event was created.');
  if(!local.recurrence.length){
   await call('remember',{eventId:local.id,version:local.version,...remoteVersion(remote)});
   return;
  }
  const baseline=seriesKey({...local,exceptions:{}});
  await call('remember',{eventId:local.id,version:null,...remoteVersion(remote),seriesState:baseline});
  if(!await syncSeries({...remote,type:'seriesMaster'},local,{event_id:local.id,outlook_id:remote.id,transaction_id:transactionId,
   retired:false,synced_version:null,change_key:remote.changeKey??null,series_state:baseline}))review=true;
 }

 async function syncSeries(remote:OutlookEvent,local:LocalEvent|undefined,link:EventLink) {
  const series=remote.type==='seriesMaster'?await readSeries(graph,calendarId,remote):null;
  const master=series?.master??await graph.event(calendarId,remote.id);
  const fields=series?.fields??(master?.type==='singleInstance'?eventFields(master):null);
  if(!fields||!master?.['@odata.etag'])return false;
  const {event_id:eventId,synced_version:syncedVersion}=link;
  const state=seriesKey(fields),version=local?.version??null;
  const remoteChanged=link.series_state?state!==link.series_state:link.change_key!==master.changeKey;
  const remember=(appliedVersion:number|null,appliedState:string,confirmed=master)=>
   call('remember',{eventId,version:appliedVersion,...remoteVersion(confirmed),seriesState:appliedState});
  if(local&&seriesKey(normalizedLocal(local))===state){
   if(version!==syncedVersion||remoteChanged)await remember(version,state);
   return true;
  }
  if(local&&version===syncedVersion) {
   if(remoteChanged)await call('receive',{eventId,version,event:carriesMetadata(local,fields),...remoteVersion(master),seriesState:state});
   return true;
  }
  if(remoteChanged||!await call('current',{eventId,version}))return false;
  if(!local) {
   if(!await graph.remove(calendarId,master.id,master['@odata.etag']))return false;
   await call('retire',{eventId});
   return true;
  }
  const next=normalizedLocal(local);
  if(next.recurrence.length&&!graphRepeat(next))return false;
  let before=fields,editable=series?.matches??new Map<string,OutlookEvent>();
  if(eventKey(next)!==eventKey(before)) {
   const updated=await graph.update(calendarId,master.id,next,before,master['@odata.etag']);
   if(!updated||updated.id!==master.id)return false;
   // A rule edit can clear Outlook exceptions. Read the new baseline before
   // applying any individual occurrence edits.
   if(next.recurrence.length) {
    const refreshed=await readSeries(graph,calendarId,updated);
    if(!refreshed||eventKey(refreshed.fields)!==eventKey(next))return false;
    before=refreshed.fields;
    editable=refreshed.matches;
    await remember(syncedVersion,seriesKey(before),refreshed.master);
   }else {
    await remember(version,seriesKey(next),updated);
    return true;
   }
  }
  const existing={...before.exceptions},target=next.exceptions??{};
  const dates=new Set([...Object.keys(existing),...Object.keys(target)]);
  // Microsoft cannot safely recreate a cancelled occurrence in place.
  // Preserve both sides if this would require undoing a cancellation.
  if([...dates].some(date=>existing[date]===null&&target[date]!==null))return false;
  for(const date of dates) {
   const previous=existing[date],desired=target[date];
   if(previous===desired||previous&&desired&&eventKey(previous)===eventKey(desired))continue;
   if(!await call('current',{eventId,version}))return false;
   let instance=editable.get(date);
   if(!instance)instance=(await graph.instances(calendarId,master.id,date)).find(item=>instanceDate(item)===date);
   if(!instance||!graphId(instance.id))return false;
   const current=await graph.event(calendarId,instance.id),currentFields=current&&eventFields(current,true);
   if(!current||!currentFields||!current['@odata.etag']||!current.changeKey||
    (instance.changeKey&&current.changeKey!==instance.changeKey))return false;
   if(desired===null) {
    if(!await graph.remove(calendarId,instance.id,current['@odata.etag']))return false;
   }else {
    const replacement=desired??occurrenceFields({...local,exceptions:{}},date);
    if(!replacement||!await graph.update(calendarId,instance.id,replacement,currentFields,current['@odata.etag']))return false;
   }
   // A reset in HH may leave an explicit Outlook override whose visible
   // values match the series. Remember its concrete values for comparisons.
   existing[date]=desired===undefined?occurrenceFields({...local,exceptions:{}},date):desired;
   await remember(syncedVersion,seriesKey({...before,exceptions:existing}));
  }
  await remember(version,seriesKey({...before,exceptions:existing}));
  return true;
 }
}
