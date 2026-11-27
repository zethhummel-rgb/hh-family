import {useEffect,useLayoutEffect,useState} from 'react';

const shades=['bg','surface','panel','field','tint','selected','hover','line','line-strong','ink','heading','muted','subtle','accent','accent-hover','focus','decoration','shadow'] as const;
type Shade=typeof shades[number];
export type Palette={id:string;name:string;description:string;swatches:string[];colours?:Record<Shade,string>};
function colours(values:string[]):Record<Shade,string>{return Object.fromEntries(shades.map((shade,i)=>[shade,values[i]])) as Record<Shade,string>}

export const PALETTES:Palette[]=[
 {id:'blush',name:'Blush & Gold',description:'Our original soft pink',swatches:['#F8E5ED','#8B4F65','#B38B50']},
 {id:'sage',name:'Sage & Linen',description:'Calm greens and warm white',swatches:['#E6EEE5','#45634D','#B38B50'],colours:colours(['#F7F9F5','#FEFFFC','#F9FBF7','#FCFDFB','#EAF0E6','#DEE8D8','#F0F5EC','#DEE6D9','#BFCEB7','#304336','#344C3B','#5F7061','#69766A','#45634D','#354F3C','#78946D','#A4B69A','#304336'])},
 {id:'coastal',name:'Coastal Blue',description:'Airy blues and pearl',swatches:['#E6EEF7','#426387','#B38B50'],colours:colours(['#F5F8FC','#FDFEFF','#F9FBFE','#FCFDFF','#E8F0F9','#DDE8F5','#EEF4FB','#DAE4F0','#B9CCE1','#2D4056','#344F6D','#5D6E83','#69788B','#426387','#324D6C','#7597BC','#A0B8D1','#2D4056'])},
 {id:'lavender',name:'Lavender',description:'Soft lilac and ivory',swatches:['#EDE6F5','#705581','#B38B50'],colours:colours(['#FAF7FC','#FFFDFF','#FCF9FE','#FEFCFF','#F0E9F7','#E8DCF1','#F6F0FB','#E6DDED','#CDBBD9','#493950','#58415F','#78657E','#7B6B81','#705581','#584068','#A088B4','#B6A0C6','#493950'])},
 {id:'sand',name:'Warm Sand',description:'Quiet beige and terracotta',swatches:['#EFE5D8','#86634A','#B38B50'],colours:colours(['#FBF8F3','#FFFEFB','#FCFAF6','#FFFDF9','#F3EBDF','#EBDFCC','#F8F2E9','#E7DDCF','#D1BEA6','#4C3C30','#634B37','#7A6958','#80715F','#86634A','#6B4C36','#B39370','#C3AC8E','#4C3C30'])},
 {id:'ivory',name:'Classic Ivory',description:'Warm whites and charcoal',swatches:['#EEECE5','#56544D','#B38B50'],colours:colours(['#FAF9F5','#FFFFFC','#FCFBF8','#FFFEFA','#F1EFE8','#E8E5DA','#F6F4EE','#E4E1D7','#C9C4B5','#383832','#44443D','#6C6B62','#77766C','#56544D','#414038','#9C9787','#B9B4A5','#383832'])},
];

const SEASONS=['spring','summer','autumn','winter','easter','halloween','christmas','thanksgiving'] as const;
export type SeasonalPaletteId=typeof SEASONS[number];
export const SEASONAL_PALETTES:Record<SeasonalPaletteId,Palette>={
 spring:{id:'spring',name:'Spring Garden',description:'Cherry blossoms, blue skies and daffodils',swatches:['#F7ADCE','#98386E','#3B83C3'],colours:colours(['#FFF4F8','#FFFCFE','#FFF4FA','#FFFCFE','#FDE3F0','#FACFE7','#FEF0F7','#F0CDDF','#D99CBF','#362240','#47244F','#653653','#704359','#98386E','#7E285B','#A33379','#C66D9F','#422840'])},
 summer:{id:'summer',name:'Summer Shore',description:'Lake blue, sunny yellow and coral',swatches:['#51BDF1','#076193','#F3B540'],colours:colours(['#F2FAFF','#FFFFFF','#F7FCFF','#FCFEFF','#CFEEFF','#BEE7FC','#E5F5FF','#BBDEEE','#86B9D4','#18374D','#123F60','#375B6D','#476178','#076193','#074E78','#0D71AA','#C97951','#183249'])},
 autumn:{id:'autumn',name:'Autumn Harvest',description:'Toasted copper and oatmeal',swatches:['#F1E4D5','#875642','#BE914C'],colours:colours(['#FAF6EF','#FFFCF8','#FBF7F0','#FFFDF8','#F1E4D5','#EBD8C7','#F6EDE2','#E7D8CA','#D5BBA8','#46352D','#563C31','#70594D','#756052','#875642','#704434','#A3745E','#C2A08B','#433129'])},
 winter:{id:'winter',name:'Winter Pine',description:'Evergreen and frosted blue',swatches:['#E4EEEF','#355A54','#AABFC3'],colours:colours(['#F4F8F8','#FCFFFF','#F6FBFB','#FCFEFE','#E4EEEF','#D9E8E8','#EEF5F5','#D8E4E5','#B4C8CB','#293E43','#2A4849','#50666A','#596E72','#355A54','#284741','#608783','#A1B9BC','#273D42'])},
 easter:{id:'easter',name:'Easter',description:'Lavender, speckled eggs and primrose',swatches:['#BF93EE','#6B3FA3','#F5CE63'],colours:colours(['#FCF5FF','#FFFDFF','#FBF6FF','#FFFCFF','#EEDFFF','#E9D4FB','#F6ECFF','#E3CEFA','#C4A2E3','#322345','#472C70','#58406F','#674E7F','#6740A3','#4F297F','#8757BC','#B775A9','#35234E'])},
 halloween:{id:'halloween',name:'Halloween',description:'Glowing pumpkins beneath a plum sky',swatches:['#452459','#B84216','#F7B354'],colours:colours(['#F9F1FF','#FFFBFC','#FFF6F3','#FFFBFD','#F1D8F6','#FFDEB9','#FAEBFB','#E8C8DF','#C5A1CC','#422241','#4C2156','#633D64','#684E68','#9B300F','#7F260E','#8840B1','#C46836','#412242'])},
 christmas:{id:'christmas',name:'Christmas',description:'Cranberry ribbons, deep fir and gold',swatches:['#1B513C','#AC2341','#E7B343'],colours:colours(['#F3F8F0','#FFFEF9','#FFFBF1','#FFFEF8','#F9E1DD','#F5CED3','#FFF2E5','#D5E1CE','#A8C4AC','#17372C','#173F30','#375641','#486251','#AC2341','#86142D','#B12E4C','#BD483F','#23382A'])},
 thanksgiving:{id:'thanksgiving',name:'Thanksgiving',description:'Cranberry, toasted oat and bright maple',swatches:['#EEA352','#942F3B','#BB5823'],colours:colours(['#FDF1E2','#FFFBF3','#FFF5E7','#FFFCF5','#F7D8B9','#F5C8AA','#FBE4CC','#F1D2AF','#C68D68','#502E26','#612E2A','#734936','#754D3B','#942F3B','#72222D','#A4461C','#C97530','#542921'])},
};

export function isSeasonalPalette(value:unknown):value is SeasonalPaletteId{return SEASONS.some(season=>season===value)}
export function paletteById(id:string):Palette{return isSeasonalPalette(id)?SEASONAL_PALETTES[id]:PALETTES.find(p=>p.id===id)||PALETTES[0]}
const storageKey=(userId:string)=>'home-together:palette:'+userId;
const seasonalKey=(userId:string)=>storageKey(userId)+':seasonal';
export const setupPaletteId='sage';

export function prepareSetupPalette(userId:string){
 try{
  const key=storageKey(userId);
  const saved=localStorage.getItem(key);
  if(!PALETTES.some(p=>p.id===saved))localStorage.setItem(key,setupPaletteId);
 }catch{/* The palette picker still works for this visit. */}
}

function readPreference(userId:string){
 try{
  const saved=localStorage.getItem(storageKey(userId));
  const standard=PALETTES.find(p=>p.id===saved)?.id||'blush';
  const seasonal=localStorage.getItem(seasonalKey(userId));
  return {userId,standard,seasonal:isSeasonalPalette(seasonal)?seasonal:null};
 }catch{return {userId,standard:'blush',seasonal:null}}
}

function applyPalette(id:string){
 const palette=paletteById(id);
 const root=document.documentElement;
 root.dataset.palette=palette.id;
 for(const shade of shades){const value=palette.colours?.[shade];if(value)root.style.setProperty('--theme-'+shade,value);else root.style.removeProperty('--theme-'+shade)}
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',palette.colours?.panel||'#f4dce4');
}

// A personal, per-account appearance preference for this browser/device.
// It never changes household membership or anyone's calendar colour.
export function usePalette(userId:string,seasons:readonly SeasonalPaletteId[]=[]){
 const [preference,setPreference]=useState(()=>readPreference(userId));
 const [message,setMessage]=useState('');
 const current=preference.userId===userId?preference:readPreference(userId);
 const paletteId=current.seasonal&&seasons.includes(current.seasonal)?current.seasonal:current.standard;
 useLayoutEffect(()=>{applyPalette(paletteId);return()=>applyPalette('blush')},[paletteId,userId]);
 useEffect(()=>{
  setMessage('');
  const sync=(event:StorageEvent)=>{if(event.key===storageKey(userId)||event.key===seasonalKey(userId)||event.key===null){setPreference(readPreference(userId));setMessage('')}};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[userId]);
 function choose(id:string){
  const seasonal=isSeasonalPalette(id);
  if(seasonal?!seasons.includes(id):!PALETTES.some(p=>p.id===id))return;
  setPreference({userId,standard:seasonal?current.standard:id,seasonal:seasonal?id:null});
  try{
   if(seasonal)localStorage.setItem(seasonalKey(userId),id);
   else{localStorage.setItem(storageKey(userId),id);localStorage.removeItem(seasonalKey(userId))}
   setMessage('Palette saved for you on this device.');
  }catch{setMessage('Palette applied for this visit. Your browser could not save the preference.')}
 }
 return {paletteId,choose,message};
}
