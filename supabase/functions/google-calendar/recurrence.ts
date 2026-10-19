export type RepeatFrequency='DAILY'|'WEEKLY'|'MONTHLY'|'YEARLY';
export type RepeatOptions={frequency:RepeatFrequency;interval:number;ending:'never'|'on'|'after';until:string;count:number};
const frequencies=['DAILY','WEEKLY','MONTHLY','YEARLY'];
const tz='America/Toronto';
const key=(d:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
export function validDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value}
function endOfDay(date:string){
 const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1);const next=d.toISOString().slice(0,10);const target=Date.parse(next+'T00:00:00Z');let guess=target;
 for(let i=0;i<3;i++){const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(guess).map(p=>[p.type,p.value]));guess+=target-Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second)}
 return new Date(guess-1000).toISOString().replace(/[-:]/g,'').replace('.000','');
}
export function buildRecurrence(options:RepeatOptions,startDate:string,allDay:boolean):string[]{
 const {frequency,interval,ending,until,count}=options;
 if(!frequencies.includes(frequency)||!Number.isInteger(interval)||interval<1||interval>999)throw Error('Choose a repeat interval from 1 to 999.');
 if(!validDate(startDate))throw Error('Choose a valid start date.');
 let rule=`RRULE:FREQ=${frequency};INTERVAL=${interval}`;
 if(ending==='on'){if(!validDate(until)||until<startDate)throw Error('The repeat end date must be on or after the first event.');rule+=';UNTIL='+(allDay?until.replaceAll('-',''):endOfDay(until))}
 else if(ending==='after'){if(!Number.isInteger(count)||count<1||count>9999)throw Error('Choose 1 to 9999 occurrences.');rule+=';COUNT='+count}
 else if(ending!=='never')throw Error('Choose when the repeat ends.');
 return [rule];
}
export function readRecurrence(rules:unknown,allDay:boolean):RepeatOptions|null{
 if(!Array.isArray(rules)||rules.length!==1||typeof rules[0]!=='string'||!rules[0].startsWith('RRULE:'))return null;
 const parts=rules[0].slice(6).split(';'),p:Record<string,string>={};for(const pair of parts){const kv=pair.split('=');if(kv.length!==2||p[kv[0]]!==undefined||!['FREQ','INTERVAL','COUNT','UNTIL'].includes(kv[0]))return null;p[kv[0]]=kv[1]}
 if(!frequencies.includes(p.FREQ)||p.COUNT&&p.UNTIL)return null;
 const interval=Number(p.INTERVAL||1),count=Number(p.COUNT||10);if(!Number.isInteger(interval)||interval<1||interval>999||!Number.isInteger(count)||count<1||count>9999)return null;
 let until='';if(p.UNTIL){if(allDay&&/^\d{8}$/.test(p.UNTIL))until=p.UNTIL.slice(0,4)+'-'+p.UNTIL.slice(4,6)+'-'+p.UNTIL.slice(6,8);else if(!allDay&&/^\d{8}T\d{6}Z$/.test(p.UNTIL)){const u=p.UNTIL;const date=new Date(`${u.slice(0,4)}-${u.slice(4,6)}-${u.slice(6,8)}T${u.slice(9,11)}:${u.slice(11,13)}:${u.slice(13,15)}Z`);if(!Number.isFinite(+date))return null;until=key(date)}else return null;if(!validDate(until))return null}
 return {frequency:p.FREQ as RepeatFrequency,interval,ending:p.COUNT?'after':p.UNTIL?'on':'never',until,count};
}
export function validateRecurrence(rules:unknown,startDate:string,allDay:boolean):string[]{
 if(Array.isArray(rules)&&rules.length===0)return [];
 const options=readRecurrence(rules,allDay);if(!options)throw Error('Choose a supported repeat pattern.');return buildRecurrence(options,startDate,allDay);
}
export function repeatDescription(options:RepeatOptions){const units={DAILY:'day',WEEKLY:'week',MONTHLY:'month',YEARLY:'year'};const unit=units[options.frequency];let text=options.interval===1?'Every '+unit:`Every ${options.interval} ${unit}s`;if(options.ending==='after')text+=` · ${options.count} occurrence${options.count===1?'':'s'}`;if(options.ending==='on'&&validDate(options.until))text+=' · through '+new Date(options.until+'T12:00:00Z').toLocaleDateString('en-CA',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'});return text}
