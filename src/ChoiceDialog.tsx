import {useEffect,useId,useRef,type ReactNode} from 'react';
import {createPortal} from 'react-dom';

export default function ChoiceDialog({title,children,onCancel,actions}:{title:string;children:ReactNode;onCancel:()=>void;actions:{label:string;run:()=>void;primary?:boolean}[]}){
 const root=useRef<HTMLDivElement>(null),cancel=useRef(onCancel),heading=useId();cancel.current=onCancel;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,overflow=document.body.style.overflow,ownsScrollLock=overflow!=='hidden';if(ownsScrollLock)document.body.style.overflow='hidden';const siblings=Array.from(document.body.children).filter((el):el is HTMLElement=>el instanceof HTMLElement&&el!==root.current?.parentElement);const inert=siblings.map(el=>el.inert);siblings.forEach(el=>{el.inert=true});root.current?.querySelector('button')?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();cancel.current()}if(e.key==='Tab'){e.preventDefault();e.stopImmediatePropagation();const buttons=Array.from(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(e.shiftKey?-1:1)+buttons.length)%buttons.length]?.focus()}};
  document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('keydown',key,true);if(ownsScrollLock)document.body.style.overflow=overflow;siblings.forEach((el,i)=>{el.inert=inert[i]});if(previous?.isConnected)previous.focus()};
 },[]);
 return createPortal(<div className="discard-backdrop choice-backdrop" onClick={e=>{e.stopPropagation();if(e.target===e.currentTarget)onCancel()}}><div ref={root} className="discard-prompt choice-dialog" role="alertdialog" aria-modal="true" aria-labelledby={heading}><h2 id={heading}>{title}</h2>{children}<div className="choice-actions">{actions.map(action=><button key={action.label} type="button" className={'button '+(action.primary?'primary':'soft')} onClick={action.run}>{action.label}</button>)}</div></div></div>,document.body);
}
