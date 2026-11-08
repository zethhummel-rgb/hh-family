import {useEffect,useRef,useState,type RefObject,type PointerEvent} from 'react';
import ChoiceDialog from './ChoiceDialog';

type Props={modal:RefObject<HTMLElement|null>;dirty:boolean;busy:boolean;onClose:()=>void;onSave:()=>void};
// Use the form's normal submit path, including native required/URL validation.
export function submitInputCard(modal:HTMLElement|null){modal?.querySelector('form')?.requestSubmit()}
export default function InputCardHandle({modal,dirty,busy,onClose,onSave}:Props){
 const [confirm,setConfirm]=useState(false);
 const drag=useRef<{id:number;x:number;y:number;distance:number;cancelled:boolean}|null>(null);
 const suppressClick=useRef(false),frame=useRef<number|null>(null);
 function reset(){if(modal.current)modal.current.style.removeProperty('translate');drag.current=null}
 useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current)},[]);
 function close(){if(busy)return;if(dirty)setConfirm(true);else onClose()}
 function start(e:PointerEvent<HTMLButtonElement>){
  if(busy||!e.isPrimary||(e.pointerType==='mouse'&&e.button!==0))return;
  suppressClick.current=false;drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,distance:0,cancelled:false};
  e.currentTarget.setPointerCapture(e.pointerId);
 }
 function move(e:PointerEvent<HTMLButtonElement>){
  const current=drag.current;if(!current||current.id!==e.pointerId)return;
  const dx=e.clientX-current.x,dy=e.clientY-current.y;
  if(Math.abs(dx)>8||Math.abs(dy)>8)suppressClick.current=true;
  if(Math.abs(dx)>20&&Math.abs(dx)>Math.abs(dy))current.cancelled=true;
  current.distance=current.cancelled?0:Math.max(0,dy);
  if(modal.current)modal.current.style.translate='0 '+Math.min(current.distance,140)+'px';
 }
 function end(e:PointerEvent<HTMLButtonElement>){
  const current=drag.current;if(!current||current.id!==e.pointerId)return;
  const dismiss=!current.cancelled&&current.distance>=64;
  reset();if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
  if(dismiss)close();
 }
 function save(){
  if(busy)return;
  setConfirm(false);
  // Remove the confirmation's inert state before validation focuses a field.
  frame.current=requestAnimationFrame(()=>{frame.current=null;onSave()});
 }
 return <><button type="button" className="input-card-handle" aria-label="Close input card" title="Swipe down to close" disabled={busy} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{suppressClick.current=true;reset()}} onLostPointerCapture={reset} onClick={e=>{e.stopPropagation();if(suppressClick.current){suppressClick.current=false;return}close()}}><span aria-hidden="true"/></button>
 {confirm&&<ChoiceDialog title="Save your changes?" onCancel={()=>setConfirm(false)} actions={[{label:'Save',primary:true,run:save},{label:'Discard',run:()=>{if(!busy)onClose()}},{label:'Keep editing',run:()=>setConfirm(false)}]}><p>You have unsaved changes.</p></ChoiceDialog>}</>;
}
