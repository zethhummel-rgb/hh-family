import {useId} from 'react';
import {Minus,Plus} from 'lucide-react';
import './grocery-details.css';
export default function QuantityFields({quantity,unit,onQuantity,onUnit,labelSuffix=''}:{quantity:string;unit:string;onQuantity:(value:string)=>void;onUnit:(value:string)=>void;labelSuffix?:string}){
 const id=useId(),label='Quantity (optional)'+labelSuffix;
 function step(amount:number){onQuantity(String(Math.min(9999,Math.max(0.001,Math.round(((quantity===''?0:Number(quantity))+amount)*1000)/1000))))}
 return <><div className="grocery-quantity-fields"><label>Quantity (optional)<span className="grocery-stepper"><button type="button" aria-label={'Decrease quantity'+labelSuffix} disabled={quantity===''||Number(quantity)<=1} onClick={()=>step(-1)}><Minus size={17}/></button><input aria-label={label} type="number" inputMode="decimal" min="0.001" max="9999" step="0.001" value={quantity} onChange={event=>onQuantity(event.target.value)} placeholder="—"/><button type="button" aria-label={'Increase quantity'+labelSuffix} disabled={Number(quantity)>=9999} onClick={()=>step(1)}><Plus size={17}/></button></span></label><label>Unit (optional)<input value={unit} aria-label={'Unit (optional)'+labelSuffix} maxLength={30} disabled={quantity===''} onChange={event=>onUnit(event.target.value)} placeholder="e.g. cans" list={id}/></label></div><datalist id={id}>{['cans','bags','boxes','bottles','packages','cups','tbsp','tsp','kg','g','L','mL'].map(value=><option key={value} value={value}/>)}</datalist></>;
}
