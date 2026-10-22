import {Share, PlusSquare, ArrowUp} from 'lucide-react';

export default function HomeScreenPictures(){
 return <div className="install-pictures" aria-label="Illustrated iPhone installation steps">
  <p className="install-picture-note">Picture guide · Example screens. Your Safari layout may look a little different.</p>
  <div className="install-picture-grid">
   <figure><div className="install-phone"><div className="install-address">hh-family · Safari</div><div className="install-page"><span className="install-monogram">Hh</span><strong>Your family, together</strong></div><div className="install-toolbar"><span>‹</span><span>›</span><span className="install-highlight"><Share size={25}/><span>Share</span></span><span>▢</span></div><div className="install-pointer"><ArrowUp size={18}/> Tap Share</div></div><figcaption><strong>1. Find Share</strong>Look for the square with an arrow pointing up. It may be inside Safari’s menu or More button.</figcaption></figure>
   <figure><div className="install-phone"><div className="install-sheet"><div className="install-handle"/><strong>HH</strong><span className="install-domain">zethhummel-rgb.github.io</span><div className="install-apps"><span>Messages</span><span>Mail</span></div><div className="install-menu-row">Copy</div><div className="install-menu-row">Add Bookmark</div><div className="install-menu-row install-highlight"><PlusSquare size={20}/><strong>Add to Home Screen</strong></div><div className="install-pointer"><ArrowUp size={18}/> Scroll down to find this</div></div></div><figcaption><strong>2. Add to Home Screen</strong>Scroll down in the Share menu and tap this row.</figcaption></figure>
   <figure><div className="install-phone"><div className="install-confirm"><div className="install-confirm-bar"><span>Cancel</span><strong>Add to Home Screen</strong><span className="install-highlight">Add</span></div><span className="install-app-icon">Hh</span><div className="install-menu-row">Name <strong>HH</strong></div><div className="install-menu-row">Open as Web App <span className="install-toggle">✓</span></div><div className="install-pointer"><ArrowUp size={18}/> Tap Add at the top right</div></div></div><figcaption><strong>3. Finish with Add</strong>Leave Open as Web App on if shown. Then open the new HH icon on your Home Screen.</figcaption></figure>
  </div>
 </div>
}
