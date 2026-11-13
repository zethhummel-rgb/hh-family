import {Settings} from 'lucide-react';
import {useRef} from 'react';

export default function CalendarSettings({showHolidays,onShowHolidays}:{showHolidays:boolean;onShowHolidays:(show:boolean)=>void}){
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
  <label className="calendar-settings-panel">
   <input type="checkbox" role="switch" aria-label="Show holidays" checked={showHolidays} onChange={event=>onShowHolidays(event.target.checked)}/>
   <span>Show holidays<small>Canada and Ontario</small></span>
  </label>
 </details>;
}
