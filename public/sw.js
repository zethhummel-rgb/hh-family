// The build replaces this manifest with the public shell and its hashed assets.
const shell = /* shopping-shell */ {version:'dev',files:[]};
const scope = self.registration.scope;
const prefix = 'hh-shopping-shell:' + new URL(scope).pathname + ':';
const cacheName = prefix + shell.version;
const allowed = new Set(shell.files.map(path=>new URL(path,scope).href));
self.addEventListener('install',event=>event.waitUntil((async()=>{
 if(shell.files.length){
   const cache=await caches.open(cacheName);
   await cache.addAll(shell.files.map(path=>new Request(new URL(path,scope),{cache:'reload'})));
 }
 await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const name of await caches.keys())if(name.startsWith(prefix)&&name!==cacheName)await caches.delete(name);
 await self.clients.claim();
})()));
self.addEventListener('message',event=>{
 if(event.data==='shopping-shell-ready')event.ports[0]?.postMessage(shell.files.length>0);
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||request.headers.has('authorization'))return;
 const url=new URL(request.url),root=new URL(scope);
 if(url.origin!==root.origin||url.search||url.hash)return;
 if(request.mode==='navigate'&&(url.pathname===root.pathname||url.href===new URL('index.html',scope).href)){
   event.respondWith(fetch(request).catch(async()=>{
     const cached=await (await caches.open(cacheName)).match(new URL('index.html',scope).href);
     if(!cached)return Response.error();
     const html=(await cached.text()).replace('<html lang="en">','<html lang="en" data-offline>');
     return new Response(html,{headers:{'Content-Type':'text/html; charset=utf-8'}});
   }));
 }else if(allowed.has(url.href)&&url.pathname!==new URL('index.html',scope).pathname){
   event.respondWith((async()=> (await (await caches.open(cacheName)).match(request)) || fetch(request))());
 }
});
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
