import {useCallback,useEffect,useLayoutEffect,useId,useRef,useState} from 'react';

export function useUnsavedChanges(dirty:boolean,busy:boolean,onClose:()=>void){
 const [confirm,setConfirm]=useState(false),latest=useRef({dirty,busy,onClose}),action=useRef<()=>void>(onClose);
 latest.current={dirty,busy,onClose};
 const requestClose=useCallback((next?:()=>void)=>{
  if(latest.current.busy)return;
  const run=next||latest.current.onClose;
  if(latest.current.dirty){action.current=run;setConfirm(true)}else run();
 },[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 return {requestClose,confirmation:confirm?<DiscardPrompt onKeep={()=>setConfirm(false)} onDiscard={()=>{if(latest.current.busy)return;setConfirm(false);action.current()}}/>:null};
}
function DiscardPrompt({onKeep,onDiscard}:{onKeep:()=>void;onDiscard:()=>void}){
 useModalScrollLock();
 const root=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector('button')?.focus();const key=(e:KeyboardEvent)=>{
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onKeep()}
  if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();const buttons=Array.from(root.current?.querySelectorAll('button')||[]);buttons[document.activeElement===buttons[0]?1:0]?.focus()}
 };document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus({preventScroll:true})}},[onKeep]);
 return <div className="discard-backdrop" onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onKeep()}}><div ref={root} className="discard-prompt" role="alertdialog" aria-modal="true" aria-labelledby={id}><h2 id={id}>Discard your changes?</h2><p>Your unfinished changes have not been saved.</p><div><button type="button" className="button primary" onClick={onKeep}>Keep editing</button><button type="button" className="button soft" onClick={onDiscard}>Discard changes</button></div></div></div>;
}
// One shared lock for stacked editors and confirmation dialogs.
// Fixing the body also holds the page on mobile Safari, where overflow alone
// can leave the document moving underneath a scrollable sheet.
let scrollLocks=0;
let releasePage:(()=>void)|null=null;
function holdPage(){
 if(scrollLocks++===0){
  const body=document.body,root=document.documentElement,x=window.scrollX,y=window.scrollY;
  const properties=['position','top','left','width','overflow','padding-right','overscroll-behavior'];
  const original=properties.map(name=>[name,body.style.getPropertyValue(name),body.style.getPropertyPriority(name)]);
  const rootProperties=['overflow','overscroll-behavior','scroll-behavior'];
  const rootOriginal=rootProperties.map(name=>[name,root.style.getPropertyValue(name),root.style.getPropertyPriority(name)]);
  const scrollbar=Math.max(0,window.innerWidth-root.clientWidth),padding=parseFloat(getComputedStyle(body).paddingRight)||0;
  root.style.setProperty('scroll-behavior','auto','important');
  root.style.setProperty('overflow','hidden','important');
  root.style.setProperty('overscroll-behavior','none','important');
  body.style.setProperty('position','fixed','important');
  body.style.setProperty('top',-y+'px','important');
  body.style.setProperty('left',-x+'px','important');
  body.style.setProperty('width','100%','important');
  body.style.setProperty('overflow','hidden','important');
  body.style.setProperty('overscroll-behavior','none','important');
  if(scrollbar)body.style.setProperty('padding-right',padding+scrollbar+'px','important');
  releasePage=()=>{
   for(const [name,value,priority] of original){if(value)body.style.setProperty(name,value,priority);else body.style.removeProperty(name)}
   for(const [name,value,priority] of rootOriginal){if(name==='scroll-behavior')continue;if(value)root.style.setProperty(name,value,priority);else root.style.removeProperty(name)}
   window.scrollTo(x,y);
   const [,value,priority]=rootOriginal.find(([name])=>name==='scroll-behavior')!;
   if(value)root.style.setProperty('scroll-behavior',value,priority);else root.style.removeProperty('scroll-behavior');
  };
 }
 let released=false;
 return()=>{if(released)return;released=true;if(--scrollLocks===0){releasePage?.();releasePage=null}};
}
export function useModalScrollLock(){useLayoutEffect(holdPage,[])}
