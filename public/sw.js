// Push only: page and asset requests always go to the network.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('push',event=>{
 let payload={};try{payload=event.data?.json()||{}}catch{}
 const url=new URL(self.registration.scope);
 if(typeof payload.taskId==='string'&&/^[a-f0-9-]{36}$/.test(payload.taskId))url.searchParams.set('reminder_task',payload.taskId);
 else if(typeof payload.date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(payload.date))url.searchParams.set('reminder_date',payload.date);
 if(!payload.taskId&&typeof payload.eventId==='string'&&payload.eventId.length<=1200)url.searchParams.set('reminder_event',payload.eventId);
 event.waitUntil(self.registration.showNotification(typeof payload.title==='string'?payload.title:'HH',{
  body:typeof payload.body==='string'?payload.body:'A reminder from your family calendar.',
  icon:new URL('icons/hh-192.png',self.registration.scope).href,
  tag:typeof payload.tag==='string'?payload.tag:'hh-reminder',data:{url:url.href},renotify:false
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 event.waitUntil((async()=>{
  const url=new URL(event.notification.data?.url||self.registration.scope);
  if(url.origin!==self.location.origin||!url.href.startsWith(self.registration.scope))return;
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const existing=windows.find(client=>client.url.startsWith(self.registration.scope));
  if(existing){await existing.navigate(url.href);await existing.focus()}else await self.clients.openWindow(url.href);
 })());
});
