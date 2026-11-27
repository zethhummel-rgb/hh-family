import {useState,type ReactNode,type Ref} from 'react';
import {Bell,Sparkles} from 'lucide-react';
import {versionedNoticeTitle} from './releaseVersion';
import './member-content.css';

const dates=new Intl.DateTimeFormat('en-CA',{dateStyle:'medium'});

export type NoticeImage={url?:string;alt:string;state?:'loading'|'error'};

export function noticeHistoryTitle(title:string,imageAlt?:string|null,releaseVersion?:string|null){
 return versionedNoticeTitle(title||imageAlt?.trim()||'Image announcement',releaseVersion);
}

export function NoticeArtwork({image}:{image:NoticeImage}){
 const [failedUrl,setFailedUrl]=useState<string>();
 const imageUrl=image.url===failedUrl?undefined:image.url;
 return imageUrl?<img className="member-notice-artwork" src={imageUrl} alt={image.alt} decoding="async" onError={()=>setFailedUrl(imageUrl)}/>
  :<div className="member-notice-artwork-fallback">
    {image.state==='loading'&&<small role="status">Loading image…</small>}
    <p>{image.alt}</p>
  </div>;
}

export default function NoticeCard({kind,title,body,publishedAt,releaseVersion,headingId,headingRef,image,action}:{
 kind:'notice'|'update';title:string;body:string;publishedAt:string;headingId?:string;
 releaseVersion?:string|null;headingRef?:Ref<HTMLHeadingElement>;image?:NoticeImage;action:ReactNode;
}){
 const update=kind==='update';
 const Icon=update?Sparkles:Bell;
 const label=update?'App update':'Notice';
 return <>
  <header className={'member-notice-header'+(image?' with-artwork':'')}>
   {!image&&<span className="member-notice-icon" aria-hidden="true"><Icon size={22} strokeWidth={1.6}/></span>}
   <h2 id={headingId} ref={headingRef} tabIndex={headingRef?-1:undefined}>{title?label:versionedNoticeTitle(label,releaseVersion)}</h2>
  </header>
  <section className={'member-notice-copy'+(image?' with-artwork':'')} tabIndex={headingRef?0:undefined}>
   {image&&<NoticeArtwork image={image}/>}
   {title&&<h3>{versionedNoticeTitle(title,releaseVersion)}</h3>}
   {(title||body)&&<time dateTime={publishedAt}>{dates.format(new Date(publishedAt))}</time>}
   {body&&<p>{body}</p>}
  </section>
  <footer className="member-notice-footer">{action}</footer>
 </>;
}
