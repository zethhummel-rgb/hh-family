import {Check,Palette} from 'lucide-react';
import {useId} from 'react';
import {PALETTES,SEASONAL_PALETTES,type Palette as PaletteOption,type SeasonalPaletteId} from './palettes';

const holidayThemes=new Set<SeasonalPaletteId>(['easter','halloween','thanksgiving','christmas']);

export default function PaletteSettings({value,onChange,message,seasons=[]}:{value:string;onChange:(id:string)=>void;message:string;seasons?:readonly SeasonalPaletteId[]}){
 const headingId=useId();
 const groups=[
  {id:'classic',title:'Classic colours',palettes:PALETTES},
  {id:'seasonal',title:'Seasonal colours',palettes:seasons.filter(id=>!holidayThemes.has(id)).map(id=>SEASONAL_PALETTES[id])},
  {id:'holiday',title:'Holiday themes',palettes:seasons.filter(id=>holidayThemes.has(id)).map(id=>SEASONAL_PALETTES[id])},
 ];
 const choice=(p:PaletteOption)=><button key={p.id} type="button" className="palette-choice" aria-pressed={value===p.id} onClick={()=>onChange(p.id)}>
  <span className="palette-preview" aria-hidden="true">{p.swatches.map((colour,i)=><i key={i} style={{backgroundColor:colour}}/>)}</span>
  <span className="palette-copy"><b>{p.name}</b><small>{p.description}</small></span>
  <span className="palette-check" aria-hidden="true">{value===p.id&&<Check size={14}/>}</span>
 </button>;
 return <section className="palette-settings" aria-labelledby={headingId}>
  <div className="palette-heading"><Palette size={18} aria-hidden="true"/><h3 id={headingId}>Colour palette</h3></div>
  <p>Make yourself at home. Choose the look you like.</p>
  {groups.filter(group=>group.palettes.length>0).map(group=><div key={group.id} className="palette-group" role="group" aria-labelledby={`${headingId}-${group.id}`}>
   <h4 id={`${headingId}-${group.id}`}>{group.title}</h4>
   <div className="palette-choices">{group.palettes.map(choice)}</div>
  </div>)}
  <p className="palette-help">Your look on this device. Family event colours stay the same.</p>
  <p className="palette-status" role="status" aria-live="polite">{message}</p>
 </section>
}
