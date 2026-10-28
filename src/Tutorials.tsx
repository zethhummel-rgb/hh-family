import {useState} from 'react';
import {BookOpen,Mail,Users,CalendarDays,ArrowUpRight,Check,Smartphone,Copy,Palette} from 'lucide-react';
import './tutorials.css';
import HomeScreenPictures from './HomeScreenPictures';

function Steps({children}:{children:React.ReactNode}){return <ol className="tutorial-steps">{children}</ol>}
export default function Tutorials({owner,onSettings,onCalendar,onWelcome,onGettingStarted,initialGuide}:{initialGuide?:'install';onGettingStarted:()=>void;owner:boolean;onWelcome:()=>void;onSettings:(page:'household'|'profile'|'notifications'|'appearance'|'calendar')=>void;onCalendar:()=>void}){
 const [copyNotice,setCopyNotice]=useState('');
 const appAddress='https://zethhummel-rgb.github.io/hh-family/';
 return <section className="tutorials" aria-label="HH tutorials">
  <div className="tutorial-welcome"><BookOpen size={22}/><p>Find these guides anytime: tap your initials in the top right, then Help & tutorials. Each settings screen has a Back button; tap Done to return to HH.</p></div>
  <button type="button" className="button soft tutorial-replay" onClick={onGettingStarted}><Check size={17}/>Show getting-started checklist</button>
  <button type="button" className="button soft tutorial-replay" onClick={onWelcome}><BookOpen size={17}/>Take the quick tour</button>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><Mail size={22}/></span><span><small>01 · FAMILY ACCOUNTS</small><h2>Invite someone by email</h2><p>Give them their own login to your shared home.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner sends the invitation</span>
    <Steps>
     <li><h3>Tap your initials in the top right corner</h3><p>Your initials are inside the coloured circle at the top of HH. Tapping them opens your settings.</p></li>
     <li><h3>Enter their email address</h3><p>In Settings, tap <strong>Your household</strong>. Under <strong>Family profiles</strong>, tap <strong>Invite by email</strong>, type their address in the email box, then tap <strong>Send invitation</strong>.</p></li>
     <li><h3>They open the invitation email</h3><p>On their phone, they open the email and tap <strong>Join your household</strong>. The invitation opens <strong>Create your account</strong>. They use the exact invited email address, or tap <strong>Sign in</strong> if they already have an account. On their own phone, they can leave <strong>Stay signed in on this device</strong> checked. After creating an account, a separate confirmation email arrives. Its link brings them back to join the household. If the invitation is missing, they can open their original invitation link again.</p></li>
     <li><h3>They join your household</h3><p>They enter their name and tap <strong>Join household</strong>. A short welcome tour shows them the shared calendar, groceries, to-dos and phone setup, and lets them pick their own colour palette. They can skip it or replay it here anytime. To pick their calendar colour, they tap their initials in the top right corner, open <strong>Your profile</strong>, choose a colour and tap <strong>Save my colour</strong>.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>One family, separate logins.</strong> Use Invite by email for someone joining your home. “Invite another household” is for a different family creating its own separate home.</p></div>
    <details className="tutorial-extra"><summary>No invitation email?</summary><p>Check Spam and confirm the address is correct. The sender can tap <strong>Copy invitation</strong> and paste it into a text message, or tap <strong>Retry email</strong> if delivery failed. Family invitations work once and expire after seven days. If a link expires or is lost, the owner can create a new invitation.</p></details>
    {owner?<button type="button" className="text-button tutorial-action" onClick={()=>onSettings('household')}>Open Your household <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to send the invitation.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon tutorial-gold"><Users size={22}/></span><span><small>02 · LITTLE FAMILY MEMBERS</small><h2>Add a child without an email</h2><p>A family profile, with no account to set up.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner adds family profiles</span>
    <Steps>
     <li><h3>Tap your initials in the top right corner</h3><p>This opens Settings. Tap <strong>Your household</strong> and find <strong>Family profiles</strong>.</p></li>
     <li><h3>Tap Add without email</h3><p>Tap the Name box and type their name. Tap <strong>Calendar colour</strong> to pick their colour. No email address or password is needed.</p></li>
     <li><h3>Save their profile</h3><p>Tap <strong>Save profile</strong>. Their name and colour now appear with your household’s people.</p></li>
     <li><h3>Include them in family plans</h3><p>Tap <strong>Calendar</strong> along the bottom, then <strong>Add event</strong>. Enter the plan and tap their name in the people choices. Their coloured dot appears on the event, and the person filter helps you find their plans. Tap Everyone for a plan involving the whole family.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>A profile doesn’t sign in.</strong> You manage their plans from your own account. If they get an account later, invite them by email first. Then open <strong>Settings → Your household → Family profiles</strong> and tap <strong>Edit</strong> beside their existing profile and select their account under <strong>Link to an account</strong> to keep their event tags.</p></div>
    {owner?<button type="button" className="text-button tutorial-action" onClick={()=>onSettings('household')}>Open Your household <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to add the profile.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><CalendarDays size={22}/></span><span><small>03 · GOOGLE CALENDAR</small><h2>See an optional Google copy</h2><p>Your HH calendar works on its own.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">One Google connection per household · Owner connects</span>
    <Steps>
     <li><h3>Open Calendar in Settings</h3><p>Tap your initials in the top right corner, then tap <strong>Calendar</strong> in Settings. Tap <strong>Connect Google</strong>. If you see Google copy enabled, a connection is already saved.</p></li>
     <li><h3>Connect your existing Google account</h3><p>Tap <strong>Connect Google Calendar</strong>. On Google’s sign-in screen, tap the account you want to use and allow the calendar permission. Follow the prompts back to HH; if your phone leaves Google in another tab, return to HH and tap its refresh symbol.</p></li>
     <li><h3>Find your family calendar</h3><p>HH creates a calendar named after your household, ending in <strong>· Family</strong>. HH copies your plans there in the background. Everyone in your household keeps using the shared HH calendar without connecting Google separately.</p></li>
     <li><h3>Make changes in HH</h3><p>Add, edit and delete your family plans in HH. Google shows an optional copy, usually updated within a minute. Changes made directly in Google do not come back to HH. If Google needs reconnecting, your HH plans and reminders keep working.</p></li>
    </Steps>
    <div className="tutorial-tip"><CalendarDays size={16}/><p><strong>Google is optional.</strong> Your HH calendar, repeating events and reminders work without connecting another calendar. Any email address can use HH. To repeat an event, tap <strong>Add event → Repeat</strong>, choose daily, weekly, monthly or yearly, then set the interval and ending. To change one date or the whole series, open the event, tap <strong>Edit</strong>, and choose <strong>Apply changes to</strong>.</p></div>
    <div className="tutorial-tip"><CalendarDays size={16}/><p><strong>Already have other Google calendars?</strong> HH copies to the family calendar it creates. Connecting your account does not automatically import, combine or subscribe to your other personal, work or shared calendars.</p></div>
    <details className="tutorial-extra"><summary>Already using Google with HH?</summary><p>Your existing Google calendar stays active until HH has preserved its plans and checked a one-time transfer. This includes repeats, changed or cancelled dates, people tags and reminder settings. If the transfer needs attention, the switch waits; the existing calendar is kept. The owner may need to reconnect Google to finish it. After the verified transfer, make changes in HH.</p></details>
    <details className="tutorial-extra"><summary>Bring a plan from another calendar</summary><p>Open <strong>Calendar → Add event</strong> in HH and copy the plan’s details. Your personal or work calendar stays separate. Moving an event into the Google copy does not import it into HH, and bulk calendar import is not available here.</p></details>
    <details className="tutorial-extra"><summary>Google needs reconnecting?</summary><p>The household owner taps their initials in the top right corner, opens <strong>Calendar</strong> in Settings, and taps <strong>Reconnect Google</strong>. Use the same Google account that originally connected the family calendar. Once HH is the calendar source, reconnecting only updates Google’s copy; your HH calendar and reminders keep working.</p></details>
    <button type="button" className="text-button tutorial-action" onClick={()=>onSettings('calendar')}>Open calendar settings <ArrowUpRight size={16}/></button>
    <button type="button" className="text-button tutorial-action" onClick={onCalendar}>Open family calendar <ArrowUpRight size={16}/></button>
   </div>
  </details>
  <details className="tutorial-guide" data-install-guide open={initialGuide==='install'?true:undefined}>
   <summary><span className="tutorial-icon tutorial-gold"><Smartphone size={22}/></span><span><small>04 · SAFARI &amp; HOME SCREEN</small><h2>Add HH to your Home Screen</h2><p>Your family’s home, one tap away.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">iPhone guide below · Android &amp; computer steps at the end</span>
    <p className="tutorial-copy-note">This adds HH as a web app (PWA), with its own Home Screen icon.</p>
    <div className="tutorial-address"><span>HH website address</span><code>{appAddress}</code><button type="button" className="text-button" onClick={async()=>{try{await navigator.clipboard.writeText(appAddress);setCopyNotice('Website address copied. Paste it into Safari’s address bar.')}catch{setCopyNotice('Touch and hold the website address above to copy it.')}}}><Copy size={15}/>Copy website address</button>{copyNotice&&<p role="status">{copyNotice}</p>}</div>
    <HomeScreenPictures/>
    <Steps>
     <li><h3>Open HH in Safari</h3><p>Open Safari on your iPhone and paste the HH address above into its address bar. Use Safari itself if you arrived through an email or social app.</p></li>
     <li><h3>Open Safari’s Share menu</h3><p>Tap the square with an upward arrow. Depending on your Safari layout, first tap the menu or More button, then <strong>Share</strong>.</p></li>
     <li><h3>Tap Add to Home Screen</h3><p>Scroll down the Share menu and tap <strong>Add to Home Screen</strong>.</p></li>
     <li><h3>Add the HH icon</h3><p>Keep the name HH. Leave <strong>Open as Web App</strong> on if it is shown, then tap <strong>Add</strong>.</p></li>
     <li><h3>Open HH from your Home Screen</h3><p>Tap the new HH icon. Sign in with your existing account if asked. After setup and the welcome tour, Home offers to enable notifications on supported devices. Its optional <strong>Getting started</strong> checklist also opens these instructions and your notification settings. Tap <strong>Enable notifications</strong>, then <strong>Allow</strong> if asked, or choose <strong>Not now</strong>.</p></li>
    </Steps>
    <details className="tutorial-extra"><summary>On Android or a computer?</summary><p>On Android, open HH in Chrome, tap its three-dot menu, then <strong>Add to Home screen</strong> or <strong>Install app</strong>, and confirm. On a computer, open HH in Chrome or Edge and look for the install icon in the address bar, or <strong>Install HH</strong> in the browser menu. Options depend on your browser. Then open the new HH icon and sign in with your existing account if asked.</p></details>
    <details className="tutorial-extra"><summary>Can’t find Add to Home Screen?</summary><p>Scroll to the bottom of Safari’s Share menu, tap <strong>Edit Actions</strong>, and add <strong>Add to Home Screen</strong>. Then try again.</p></details>
    <div className="tutorial-tip"><Check size={16}/><p><strong>Want reminder notifications?</strong> Accept the prompt on Home, or open HH from its Home Screen icon, tap your initials in the top right corner, tap <strong>Notifications</strong>, then tap <strong>Enable notifications</strong> and allow the request. Tap <strong>Send a test</strong> to check it. Each person enables their own phone. Calendar events include a notification 30 minutes before by default. To turn it off, open the event, tap Edit, turn off 30-minute notification and save. Any additional reminder stays enabled. All-day reminders count back from 9 AM Eastern.</p></div>
    <a className="text-button tutorial-source" href="https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer">Apple’s Safari installation guide <ArrowUpRight size={14}/></a>
    <button type="button" className="text-button tutorial-action" onClick={()=>onSettings('notifications')}>Open Notifications <ArrowUpRight size={16}/></button>
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><Palette size={22}/></span><span><small>05 · YOUR LOOK &amp; COLOUR</small><h2>Make HH feel like you</h2><p>Your app’s palette and your family calendar dot.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body">
    <Steps>
     <li><h3>Open Appearance</h3><p>Tap your initials in the top right corner, then tap <strong>Appearance</strong>. Tap a colour palette to preview it. It saves automatically on this device.</p></li>
     <li><h3>Choose your calendar colour</h3><p>Tap <strong>Back</strong>, then tap your profile card at the top of Settings. Under <strong>Your calendar colour</strong>, choose a dot or custom colour and tap <strong>Save my colour</strong>. Your family sees that dot beside events you’re tagged in.</p></li>
     <li><h3>Return to your home</h3><p>Tap <strong>Done</strong> in the top right corner. To find any of these guides again, open Settings and tap <strong>Help &amp; tutorials</strong>.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p>Your <strong>palette</strong> changes how HH looks on this device. Your <strong>calendar colour</strong> identifies you in family plans and is shared with your household.</p></div>
    <details className="tutorial-extra"><summary>Delete your account or household</summary><p>Members open <strong>Settings → Your profile → Delete my account</strong> and type their email to confirm. Shared family plans remain. Owners open <strong>Settings → Your household → Delete home and all accounts</strong> and type the household name. This permanently removes the entire home and every member’s account. Existing Google calendars remain in Google; logs and backups follow provider retention. Pilot administrator accounts are protected.</p></details>
    <button type="button" className="text-button tutorial-action" onClick={()=>onSettings('appearance')}>Open Appearance <ArrowUpRight size={16}/></button>
    <button type="button" className="text-button tutorial-action" onClick={()=>onSettings('profile')}>Open Your profile <ArrowUpRight size={16}/></button>
   </div>
  </details>
 </section>
}
