import {useEffect,useId,useRef,useState,type ReactNode,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {useModalScrollLock} from './useUnsavedChanges';
import './member-content.css';

type Heading={headingId:string;headingRef:RefObject<HTMLHeadingElement|null>};

export default function MemberPopup({className,onOpen,onCancel,children}:{
 className?:string;onOpen?:()=>void;onCancel:()=>void;children:(heading:Heading)=>ReactNode;
}){
 const dialog=useRef<HTMLDialogElement>(null);
 const headingRef=useRef<HTMLHeadingElement>(null);
 const headingId=useId();
 const opened=useRef(onOpen);
 const [open,setOpen]=useState(false);
 opened.current=onOpen;
 useModalScrollLock(open);

 useEffect(()=>{
  const modal=dialog.current!;
  let opener:HTMLElement|null=null;
  let frame=0;
  function openWhenReady(){
   window.cancelAnimationFrame(frame);
   frame=window.requestAnimationFrame(()=>{
    const anotherDialog=Array.from(document.querySelectorAll<HTMLElement>('dialog[open],[aria-modal="true"]'))
     .some(element=>element!==modal&&element.getClientRects().length>0);
    const editing=document.activeElement?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]');
    if(document.hidden||!modal.isConnected||modal.open||anotherDialog||editing)return;
    opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    modal.showModal();
    headingRef.current?.focus({preventScroll:true});
    setOpen(true);
    opened.current?.();
    observer.disconnect();
   });
  }
  const observer=new MutationObserver(openWhenReady);
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','hidden','aria-modal']});
  document.addEventListener('focusout',openWhenReady);
  document.addEventListener('visibilitychange',openWhenReady);
  openWhenReady();
  return()=>{
   observer.disconnect();
   window.cancelAnimationFrame(frame);
   document.removeEventListener('focusout',openWhenReady);
   document.removeEventListener('visibilitychange',openWhenReady);
   if(modal.open)modal.close();
   if(opener?.isConnected)opener.focus({preventScroll:true});
  };
 },[]);

 return createPortal(<dialog ref={dialog} className={className?`member-notice-dialog ${className}`:'member-notice-dialog'} aria-labelledby={headingId} onCancel={event=>{
  event.preventDefault();onCancel();
 }}>{children({headingId,headingRef})}</dialog>,document.body);
}
