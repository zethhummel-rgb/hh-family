import {useEffect,useLayoutEffect,useState} from 'react';

const shades=['bg','surface','panel','field','tint','selected','hover','line','line-strong','ink','heading','muted','subtle','accent','accent-hover','focus','decoration','shadow'] as const;
type Shade=typeof shades[number];
type Palette={id:string;name:string;description:string;swatches:string[];colours?:Record<Shade,string>};
function colours(values:string[]):Record<Shade,string>{return Object.fromEntries(shades.map((shade,i)=>[shade,values[i]])) as Record<Shade,string>}

export const PALETTES:Palette[]=[
 {id:'blush',name:'Blush & Gold',description:'Our original soft pink',swatches:['#F8E5ED','#8B4F65','#B38B50']},
 {id:'sage',name:'Sage & Linen',description:'Calm greens and warm white',swatches:['#E6EEE5','#45634D','#B38B50'],colours:colours(['#F7F9F5','#FEFFFC','#F9FBF7','#FCFDFB','#EAF0E6','#DEE8D8','#F0F5EC','#DEE6D9','#BFCEB7','#304336','#344C3B','#5F7061','#69766A','#45634D','#354F3C','#78946D','#A4B69A','#304336'])},
 {id:'coastal',name:'Coastal Blue',description:'Airy blues and pearl',swatches:['#E6EEF7','#426387','#B38B50'],colours:colours(['#F5F8FC','#FDFEFF','#F9FBFE','#FCFDFF','#E8F0F9','#DDE8F5','#EEF4FB','#DAE4F0','#B9CCE1','#2D4056','#344F6D','#5D6E83','#69788B','#426387','#324D6C','#7597BC','#A0B8D1','#2D4056'])},
 {id:'lavender',name:'Lavender',description:'Soft lilac and ivory',swatches:['#EDE6F5','#705581','#B38B50'],colours:colours(['#FAF7FC','#FFFDFF','#FCF9FE','#FEFCFF','#F0E9F7','#E8DCF1','#F6F0FB','#E6DDED','#CDBBD9','#493950','#58415F','#78657E','#7B6B81','#705581','#584068','#A088B4','#B6A0C6','#493950'])},
 {id:'sand',name:'Warm Sand',description:'Quiet beige and terracotta',swatches:['#EFE5D8','#86634A','#B38B50'],colours:colours(['#FBF8F3','#FFFEFB','#FCFAF6','#FFFDF9','#F3EBDF','#EBDFCC','#F8F2E9','#E7DDCF','#D1BEA6','#4C3C30','#634B37','#7A6958','#80715F','#86634A','#6B4C36','#B39370','#C3AC8E','#4C3C30'])},
 {id:'ivory',name:'Classic Ivory',description:'Warm whites and charcoal',swatches:['#EEECE5','#56544D','#B38B50'],colours:colours(['#FAF9F5','#FFFFFC','#FCFBF8','#FFFEFA','#F1EFE8','#E8E5DA','#F6F4EE','#E4E1D7','#C9C4B5','#383832','#44443D','#6C6B62','#77766C','#56544D','#414038','#9C9787','#B9B4A5','#383832'])},
];

const storageKey=(userId:string)=>'home-together:palette:'+userId;
function validPalette(value:string|null):string{return PALETTES.some(p=>p.id===value)?value!:'blush'}
function readPalette(userId:string):string{try{return validPalette(localStorage.getItem(storageKey(userId)))}catch{return 'blush'}}

function applyPalette(id:string){
 const palette=PALETTES.find(p=>p.id===id)||PALETTES[0];
 const root=document.documentElement;
 root.dataset.palette=palette.id;
 for(const shade of shades){const value=palette.colours?.[shade];if(value)root.style.setProperty('--theme-'+shade,value);else root.style.removeProperty('--theme-'+shade)}
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',palette.colours?.panel||'#f4dce4');
}

// A personal, per-account appearance preference for this browser/device.
// It never changes household membership or anyone's calendar colour.
export function usePalette(userId:string){
 const [preference,setPreference]=useState(()=>({userId,id:readPalette(userId)}));
 const [message,setMessage]=useState('');
 const paletteId=preference.userId===userId?preference.id:readPalette(userId);
 useLayoutEffect(()=>{applyPalette(paletteId);return()=>applyPalette('blush')},[paletteId,userId]);
 useEffect(()=>{
  setMessage('');
  const sync=(event:StorageEvent)=>{if(event.key===storageKey(userId)||event.key===null){setPreference({userId,id:readPalette(userId)});setMessage('')}};
  window.addEventListener('storage',sync);return()=>window.removeEventListener('storage',sync);
 },[userId]);
 function choose(id:string){
  if(!PALETTES.some(p=>p.id===id))return;
  setPreference({userId,id});
  try{localStorage.setItem(storageKey(userId),id);setMessage('Palette saved for you on this device.')}catch{setMessage('Palette applied for this visit. Your browser could not save the preference.')}
 }
 return {paletteId,choose,message};
}
