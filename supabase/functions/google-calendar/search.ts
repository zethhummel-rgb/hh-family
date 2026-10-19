export type SearchPeriod='all'|'upcoming'|'past';
export function searchParameters(input:{query?:unknown;period?:unknown;pageToken?:unknown;asOf?:unknown},now=new Date()){
 if(typeof input.query!=='string'||!input.query.trim()||input.query.trim().length>150)throw Error('Enter a search from 1 to 150 characters.');
 if(!['all','upcoming','past'].includes(input.period as string))throw Error('Choose all dates, upcoming, or past.');
 if(input.pageToken!==undefined&&(typeof input.pageToken!=='string'||input.pageToken.length>4096))throw Error('Please start the search again.');
 const asOf=input.asOf===undefined?now.toISOString():input.asOf;
 if(typeof asOf!=='string'||!Number.isFinite(Date.parse(asOf)))throw Error('Please start the search again.');
 const anchor=new Date(asOf).toISOString();
 const params=new URLSearchParams({q:input.query.trim(),singleEvents:'true',orderBy:'startTime',maxResults:'50',showDeleted:'false',timeZone:'America/Toronto'});
 if(input.period==='upcoming')params.set('timeMin',anchor);
 if(input.period==='past')params.set('timeMax',anchor);
 if(input.pageToken)params.set('pageToken',input.pageToken as string);
 return {params,asOf:anchor};
}
