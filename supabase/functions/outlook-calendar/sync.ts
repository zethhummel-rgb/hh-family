import {createGraph,eventFields,eventKey,graphId,OutlookProblem,type EventFields,type OutlookEvent} from './graph.ts';

type LocalEvent=EventFields&{id:string;version:number;recurrence:string[]};
type EventLink={event_id:string;outlook_id:string|null;transaction_id:string;synced_version:number|null;change_key:string|null;retired:boolean};
type Call=(action:string,payload?:Record<string,unknown>)=>Promise<unknown>;
type Graph=ReturnType<typeof createGraph>;

function remoteVersion(event:OutlookEvent) {
 if(!graphId(event.id)||!event.changeKey)throw new OutlookProblem('retry','Microsoft did not return an event version.');
 return {outlookId:event.id,changeKey:event.changeKey};
}

export async function syncEvents(graph:Graph,call:Call,calendarId:string,initial:boolean) {
 const calendar=await graph.calendar(calendarId);
 if(calendar?.id!==calendarId||calendar.canEdit!==true)
  throw new OutlookProblem('reconnect','The selected Outlook calendar is no longer writable.');
 const {events,links,importEvents}=await call('snapshot') as {events:LocalEvent[];links:EventLink[];importEvents:boolean};
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
    if(local&&!local.recurrence.length)await sendNew(local,link.transaction_id);
    if(!local)await call('retire',{eventId});
    continue;
   }
   if(await graph.exists(link.outlook_id)){review=true;continue}
   if(!local){await call('retire',{eventId});continue}
   if(version!==link.synced_version||local.recurrence.length){review=true;continue}
   await call('remove',{eventId,version,outlookId:link.outlook_id});
   continue;
  }
  const fields=eventFields(remote);
  if(!fields||local?.recurrence.length){review=true;continue}
  const remoteVersionFields=remoteVersion(remote);
  if(!local||version!==link.synced_version) {
   if(local&&eventKey(local)===eventKey(fields)) {
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
   if(local) {
    const updated=await graph.update(calendarId,remote.id,local,currentFields,current['@odata.etag']);
    if(!updated||updated.id!==remote.id)throw new OutlookProblem('retry','Outlook did not confirm the event change.');
    await call('remember',{eventId,version,...remoteVersion(updated)});
   }else {
    if(!await graph.remove(calendarId,remote.id,current['@odata.etag']))
     throw new OutlookProblem('retry','Outlook did not confirm the event was removed.');
    await call('retire',{eventId});
   }
  }else if(link.change_key!==remote.changeKey) {
   if(eventKey(local)===eventKey(fields))await call('remember',{eventId,version,...remoteVersionFields});
   else await call('receive',{eventId,version,event:fields,...remoteVersionFields});
  }
 }

 const unshared=events.filter(local=>!claimedLocal.has(local.id)&&!local.recurrence.length);
 if(importEvents) {
  const unpaired=remotes.flatMap(remote=>{
   const fields=claimedRemote.has(remote.id)?null:eventFields(remote);
   return fields?[{remote,fields,key:eventKey(fields)}]:[];
  });
  for(const {remote,fields,key} of unpaired) {
   const exact=initial?unshared.filter(local=>eventKey(local)===key):[];
   if(exact.length) {
    for(const local of exact)claimedLocal.add(local.id);
    if(exact.length===1&&unpaired.filter(item=>item.key===key).length===1) {
     const {id:eventId,version}=exact[0];
     await call('match',{eventId,version,...remoteVersion(remote)});
    }else review=true;
   }else await call('receive',{event:fields,...remoteVersion(remote)});
  }
 }
 for(const local of unshared)if(!claimedLocal.has(local.id)) {
  const transactionId=await call('reserve',{eventId:local.id,version:local.version});
  if(typeof transactionId==='string')await sendNew(local,transactionId);
 }
 return review?'review':null;

 async function sendNew(local:LocalEvent,transactionId:string) {
  if(!await call('current',{eventId:local.id,version:local.version}))return;
  const remote=await graph.create(calendarId,local,transactionId);
  if(!remote)throw new OutlookProblem('retry','Outlook did not confirm the event was created.');
  await call('remember',{eventId:local.id,version:local.version,...remoteVersion(remote)});
 }
}
