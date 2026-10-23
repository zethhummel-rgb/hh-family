type Store=Pick<Storage,'getItem'|'setItem'>;
type Progress={dismissed:boolean;eventAdded:boolean};
const key=(userId:string,householdId:string)=>`hh:getting-started:v1:${userId}:${householdId}`;
const fallback=new Map<string,Progress>();
export function gettingStartedProgress(userId:string,householdId:string,storage?:Store):Progress{
 const id=key(userId,householdId);
 if(fallback.has(id))return fallback.get(id)!;
 try{const value=JSON.parse((storage??localStorage).getItem(id)||'{}');return {dismissed:value?.dismissed===true,eventAdded:value?.eventAdded===true}}
 catch{return fallback.get(id)||{dismissed:false,eventAdded:false}}
}
export function saveGettingStarted(userId:string,householdId:string,patch:Partial<Progress>,storage?:Store){
 const value={...gettingStartedProgress(userId,householdId,storage),...patch},id=key(userId,householdId);
 try{(storage??localStorage).setItem(id,JSON.stringify(value));fallback.delete(id)}catch{fallback.set(id,value)}
 return value;
}
