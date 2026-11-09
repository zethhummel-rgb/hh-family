import {useRef,useState,type InputHTMLAttributes,type RefObject} from 'react';
type Props=Omit<InputHTMLAttributes<HTMLInputElement>,'type'> & {label:string;inputRef?:RefObject<HTMLInputElement|null>;help?:string};
export default function PasswordField({label,inputRef,help,...props}:Props){
 const [visible,setVisible]=useState(false),own=useRef<HTMLInputElement>(null),input=inputRef||own;
 return <label className="password-field"><span>{label}</span><span className="password-control"><input {...props} ref={input} aria-label={label} type={visible?'text':'password'}/><button type="button" disabled={props.disabled} aria-label={(visible?'Hide ':'Show ')+label.toLowerCase()} aria-pressed={visible} onMouseDown={e=>e.preventDefault()} onClick={()=>{const node=input.current,start=node?.selectionStart,end=node?.selectionEnd;setVisible(v=>!v);requestAnimationFrame(()=>{node?.focus({preventScroll:true});if(start!=null&&end!=null)node?.setSelectionRange(start,end)})}}>{visible?'Hide':'Show'}</button></span>{help&&<small>{help}</small>}</label>;
}
