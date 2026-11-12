type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type FamilySetupStep='email'|'profiles'|'palette';
type FamilySetupProgress={step:FamilySetupStep;paletteFirst:boolean};
const key=(userId:string,householdId:string,paletteFirst:boolean)=>`hh:family-setup:v${paletteFirst?2:1}:${userId}:${householdId}`;
const validStep=(step:string|null):step is FamilySetupStep=>step==='email'||step==='profiles'||step==='palette';

export function queueFamilySetup(userId:string,householdId:string,store?:Store){
 try{(store??sessionStorage).setItem(key(userId,householdId,true),'palette')}catch{/* Family actions remain available in Settings. */}
}
export function familySetupProgress(userId:string,householdId:string,store?:Store):FamilySetupProgress|null{
 try{
  const storage=store??sessionStorage;
  const step=storage.getItem(key(userId,householdId,true));
  if(validStep(step))return {step,paletteFirst:true};
  const legacy=storage.getItem(key(userId,householdId,false));
  return validStep(legacy)?{step:legacy,paletteFirst:false}:null;
 }catch{return null}
}
export function saveFamilySetupStep(userId:string,householdId:string,progress:FamilySetupProgress,store?:Store){
 try{(store??sessionStorage).setItem(key(userId,householdId,progress.paletteFirst),progress.step)}catch{/* The current screen still works without storage. */}
}
export function finishFamilySetup(userId:string,householdId:string,store?:Store){
 try{
  const storage=store??sessionStorage;
  storage.removeItem(key(userId,householdId,true));
  storage.removeItem(key(userId,householdId,false));
 }catch{/* Family actions remain available in Settings. */}
}
