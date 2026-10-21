type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type FamilySetupStep='email'|'profiles'|'palette';
const key=(userId:string,householdId:string)=>`hh:family-setup:v1:${userId}:${householdId}`;

export function queueFamilySetup(userId:string,householdId:string,store?:Store){
 try{(store??sessionStorage).setItem(key(userId,householdId),'email')}catch{/* Family actions remain available in Settings. */}
}
export function familySetupStep(userId:string,householdId:string,store?:Store):FamilySetupStep|null{
 try{const step=(store??sessionStorage).getItem(key(userId,householdId));return step==='email'||step==='profiles'||step==='palette'?step:null}catch{return null}
}
export function saveFamilySetupStep(userId:string,householdId:string,step:FamilySetupStep,store?:Store){
 try{(store??sessionStorage).setItem(key(userId,householdId),step)}catch{/* The current screen still works without storage. */}
}
export function finishFamilySetup(userId:string,householdId:string,store?:Store){
 try{(store??sessionStorage).removeItem(key(userId,householdId))}catch{/* Family actions remain available in Settings. */}
}
