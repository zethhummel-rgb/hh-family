import {Check,Pencil,Repeat2,Trash2} from 'lucide-react';
import {reminderIsDone,reminderWaiting,taskRepeatLabel,taskTimeLabel,type ReminderItem} from './taskReminders';

export default function ReminderRow({item,today,busy,highlight,onEdit,onToggle,onDelete}:{item:ReminderItem;today:string;busy:boolean;highlight:boolean;onEdit:()=>void;onToggle:()=>void;onDelete:()=>void}){
 const waiting=reminderWaiting(item,today),done=reminderIsDone(item,today);
 const date=(value:string)=>new Date(value+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',day:'numeric',year:value.slice(0,4)!==today.slice(0,4)?'numeric':undefined});
 const completed=item.last_completed_at?new Date(item.last_completed_at).toLocaleDateString('en-CA',{timeZone:'America/Toronto',month:'short',day:'numeric'}):'';
 return <div id={'reminder-'+item.id} className={'item reminder-row'+(done?' completed':'')+(highlight?' reminder-highlight':'')}>
  {waiting?<span className="checkbox reminder-done-mark" role="img" aria-label={'Completed. Next due '+date(item.due)}><Check size={15}/></span>:<button type="button" className="checkbox" disabled={busy} aria-label={`${item.done?'Restore':'Complete'} ${item.title}`} aria-pressed={!!item.done} onClick={onToggle}>{!!item.done&&<Check size={15}/>}</button>}
  <div className="item-copy"><button type="button" className="reminder-title" onClick={onEdit} aria-label={'Edit to do '+item.title}>{item.title}</button>
   {done&&completed&&<small>Completed {completed}</small>}
   {item.due&&<small className={!done&&item.due<today?'overdue':''}>{waiting?'Next: ':''}{item.due===today?'Today':date(item.due)}{item.reminder_time?' · '+taskTimeLabel(item.reminder_time):''}{!done&&item.due<today?' · Overdue':''}</small>}
   <div className="reminder-meta">{item.repeat_unit&&item.repeat_unit!=='none'&&<small className="task-repeat"><Repeat2 size={11}/>{taskRepeatLabel(item.repeat_unit,item.repeat_every)}</small>}<small>{item.person||'Everyone'}</small></div>
  </div>
  <div className="reminder-actions"><button type="button" className="reminder-edit" aria-label={'Edit settings for '+item.title} disabled={busy} onClick={onEdit}><Pencil size={14}/><span>Edit</span></button><button type="button" className="delete" aria-label={'Delete '+item.title} disabled={busy} onClick={onDelete}><Trash2 size={15}/></button></div>
 </div>
}
