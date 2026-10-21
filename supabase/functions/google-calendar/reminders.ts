// Additional reminder contract. The separate 30-minute switch controls the default alert.
export function reminderMinutes(value:unknown):number|null{
 if(value===null||value===undefined||value==='')return null;
 if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>10080)throw Error('Choose a reminder from 0 to 10,080 minutes.');
 return value;
}
export function readReminder(value:unknown):number|null{
 if(typeof value!=='string'||!/^\d{1,5}$/.test(value))return null;
 try{return reminderMinutes(Number(value))}catch{return null}
}
export function reminderLabel(minutes:number|null|undefined){
 if(minutes==null)return 'No reminder';if(minutes===0)return 'At the start';
 if(minutes%1440===0)return `${minutes/1440} day${minutes===1440?'':'s'} before`;
 if(minutes%60===0)return `${minutes/60} hour${minutes===60?'':'s'} before`;
 return `${minutes} minutes before`;
}
