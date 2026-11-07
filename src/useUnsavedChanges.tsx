import {useCallback,useEffect,useId,useRef,useState} from 'react';

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
 const root=useRef<HTMLDivElement>(null),id=useId();
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;root.current?.querySelector('button')?.focus();const key=(e:KeyboardEvent)=>{
  if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();onKeep()}
  if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();const buttons=Array.from(root.current?.querySelectorAll('button')||[]);buttons[document.activeElement===buttons[0]?1:0]?.focus()}
 };document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);if(previous?.isConnected)previous.focus()}},[onKeep]);
 return <div className="discard-backdrop" onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onKeep()}}><div ref={root} className="discard-prompt" role="alertdialog" aria-modal="true" aria-labelledby={id}><h2 id={id}>Discard your changes?</h2><p>Your unfinished changes have not been saved.</p><div><button type="button" className="button primary" onClick={onKeep}>Keep editing</button><button type="button" className="button soft" onClick={onDiscard}>Discard changes</button></div></div></div>;
}
export function useModalScrollLock(){useEffect(()=>{const old=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=old}},[])}
