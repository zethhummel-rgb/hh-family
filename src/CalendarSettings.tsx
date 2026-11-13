import {Settings} from 'lucide-react';
import {useRef} from 'react';

export default function CalendarSettings({showHolidays,onShowHolidays,busy,error}:{showHolidays:boolean;onShowHolidays:(show:boolean)=>void;busy:boolean;error:string}){
 const trigger=useRef<HTMLElement>(null);
 return <details className="calendar-settings" onBlur={event=>{
  if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget))event.currentTarget.open=false;
 }} onKeyDown={event=>{
  if(event.key!=='Escape'||!event.currentTarget.open)return;
  event.stopPropagation();
  event.currentTarget.open=false;
  trigger.current?.focus();
 }}>
  <summary ref={trigger} aria-label="Calendar settings" title="Calendar settings"><Settings size={19} aria-hidden="true"/></summary>
  <div className="calendar-settings-panel">
   <label>
    <input type="checkbox" role="switch" aria-label="Show holidays" checked={showHolidays} aria-disabled={busy} onChange={event=>{if(!busy)onShowHolidays(event.target.checked)}}/>
    <span>Show holidays<small>Canada and Ontario</small></span>
   </label>
   {error&&<p role="alert">{error}</p>}
  </div>
 </details>;
}
