import {useLayoutEffect,type CSSProperties,type ReactNode} from 'react';
import {PALETTES,setupPaletteId} from './palettes';
import PublicLinks from './PublicLinks';
import './auth-layout.css';

const colours=PALETTES.find(palette=>palette.id===setupPaletteId)?.colours;
const theme=Object.fromEntries(Object.entries(colours??{}).map(([shade,colour])=>['--theme-'+shade,colour])) as CSSProperties;

export default function AuthLayout({children,loading=false}:{children:ReactNode;loading?:boolean}){
 useLayoutEffect(()=>{
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',colours?.panel??'#f9fbf7');
 },[]);

 return <div className="auth-layout website-auth" style={theme}>
  <header className="auth-site-header">
   <a className="auth-brand" href="./home.html" aria-label="HH Family homepage">
    <img src="./icons/hh-180.png" alt="" width={46} height={46}/>
    <span>HH Family</span>
   </a>
  </header>
  <div className={'auth-content'+(loading?' auth-loading':'')}>
   {!loading&&<aside className="auth-art" aria-label="HH preview">
    <div>
     <p className="auth-tagline">A little more together.</p>
     <span className="auth-gold-line" aria-hidden="true"/>
     <p>One shared place for family plans, groceries, and invites.</p>
    </div>
    <figure className="auth-preview">
     <img src="./homepage/screens/home.webp" alt="The HH home screen shows today’s meals and upcoming family plans." width={780} height={1170} loading="lazy" decoding="async"/>
     <figcaption>HH Home · Sample household</figcaption>
    </figure>
   </aside>}
   <main className="auth-main">
    <section className="auth-card">
     {children}
     {!loading&&<div className="auth-footnote"><PublicLinks/></div>}
    </section>
   </main>
  </div>
 </div>;
}
