import ChoiceDialog from './ChoiceDialog';
import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';

export function useUnsavedChanges(dirty:boolean,busy:boolean,onClose:()=>void,onSave?:()=>Promise<boolean>|boolean|void){
 const [confirm,setConfirm]=useState(false),latest=useRef({dirty,busy,onClose,onSave}),action=useRef<()=>void>(onClose),saving=useRef(false);
 latest.current={dirty,busy,onClose,onSave};
 const requestClose=useCallback((next?:()=>void)=>{
  if(latest.current.busy||saving.current)return;
  const run=next||latest.current.onClose;
  if(latest.current.dirty){action.current=run;setConfirm(true)}else run();
 },[]);
 useEffect(()=>{if(!dirty)return;const warn=(e:BeforeUnloadEvent)=>{e.preventDefault();e.returnValue=''};window.addEventListener('beforeunload',warn);return()=>window.removeEventListener('beforeunload',warn)},[dirty]);
 async function save(){
  if(latest.current.busy||saving.current)return;
  saving.current=true;setConfirm(false);
  // First release the confirmation's inert state so native validation can focus.
  await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  try{if(await latest.current.onSave?.()===true)action.current()}finally{saving.current=false}
 }
 return {requestClose,confirmation:confirm?<ChoiceDialog title="Save your changes?" onCancel={()=>setConfirm(false)} actions={[...(onSave?[{label:'Save',primary:true,run:()=>void save()}]:[]),{label:'Discard',run:()=>{if(latest.current.busy||saving.current)return;setConfirm(false);action.current()}},{label:'Keep editing',run:()=>setConfirm(false)}]}><p>You have unsaved changes.</p></ChoiceDialog>:null};
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

