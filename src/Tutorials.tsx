import {useState} from 'react';
import {BookOpen,Mail,Users,CalendarDays,ArrowUpRight,Check,Smartphone,Copy} from 'lucide-react';
import './tutorials.css';

function Steps({children}:{children:React.ReactNode}){return <ol className="tutorial-steps">{children}</ol>}
export default function Tutorials({owner,onSettings,onCalendar,onWelcome}:{owner:boolean;onWelcome:()=>void;onSettings:()=>void;onCalendar:()=>void}){
 const [copyNotice,setCopyNotice]=useState('');
 const appAddress='https://zethhummel-rgb.github.io/hh-family/';
 return <section className="tutorials" aria-label="HH tutorials">
  <div className="tutorial-welcome"><BookOpen size={22}/><p>Help is always here at the bottom of your settings. Tap a guide, follow the steps, and come back here whenever you need a hand.</p></div>
  <button type="button" className="button soft tutorial-replay" onClick={onWelcome}><BookOpen size={17}/>Take the quick tour</button>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><Mail size={22}/></span><span><small>01 · FAMILY ACCOUNTS</small><h2>Invite someone by email</h2><p>Give them their own login to your shared home.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner sends the invitation</span>
    <Steps>
     <li><h3>Tap your initials in the top right corner</h3><p>Your initials are inside the coloured circle at the top of HH. Tapping them opens your settings.</p></li>
     <li><h3>Enter their email address</h3><p>Swipe up inside settings to find <strong>Family profiles</strong>. Tap <strong>Invite by email</strong>, type their address in the email box, then tap <strong>Send invitation</strong>.</p></li>
     <li><h3>They open the invitation email</h3><p>On their phone, they open the email and tap <strong>Join your household</strong>. They tap <strong>Create account</strong>, or sign in if they already have one, using the exact invited email address. If asked to confirm their email, they open the confirmation email, then tap the original invitation link again.</p></li>
     <li><h3>They join your household</h3><p>They enter their name and tap <strong>Join household</strong>. Their own login opens the same family calendar, groceries and to-dos. To pick their calendar colour, they tap their initials in the top right corner.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>One family, separate logins.</strong> Use Invite by email for someone joining your home. “Invite another household” is for a different family creating its own separate home.</p></div>
    <details className="tutorial-extra"><summary>No invitation email?</summary><p>Check Spam and confirm the address is correct. The sender can tap <strong>Copy invitation</strong> and paste it into a text message, or tap <strong>Retry email</strong> if delivery failed. Family invitations work once and expire after seven days. If a link expires or is lost, the owner can create a new invitation.</p></details>
    {owner?<button type="button" className="text-button tutorial-action" onClick={onSettings}>Take me to my settings <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to send the invitation.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon tutorial-gold"><Users size={22}/></span><span><small>02 · LITTLE FAMILY MEMBERS</small><h2>Add a child without an email</h2><p>A family profile, with no account to set up.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner adds family profiles</span>
    <Steps>
     <li><h3>Tap your initials in the top right corner</h3><p>This opens your settings. Swipe up inside the settings window until you reach <strong>Family profiles</strong>.</p></li>
     <li><h3>Tap Add without email</h3><p>Tap the Name box and type their name. Tap <strong>Calendar colour</strong> to pick their colour. No email address or password is needed.</p></li>
     <li><h3>Save their profile</h3><p>Tap <strong>Save profile</strong>. Their name and colour now appear with your household’s people.</p></li>
     <li><h3>Include them in family plans</h3><p>Tap <strong>Calendar</strong> along the bottom, then <strong>Add event</strong>. Enter the plan and tap their name in the people choices. Their coloured dot appears on the event, and the person filter helps you find their plans. Tap Everyone for a plan involving the whole family.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>A profile doesn’t sign in.</strong> You manage their plans from your own account. If they get an account later, invite them by email first. Then, in Family profiles, tap <strong>Edit</strong> beside their existing profile and select their account under <strong>Link to an account</strong> to keep their event tags.</p></div>
    {owner?<button type="button" className="text-button tutorial-action" onClick={onSettings}>Take me to my settings <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to add the profile.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><CalendarDays size={22}/></span><span><small>03 · GOOGLE CALENDAR</small><h2>Connect Google &amp; bring your plans</h2><p>Use your existing Google account with HH.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">One Google connection per household · Owner connects</span>
    <Steps>
     <li><h3>Open the Calendar tab</h3><p>Tap <strong>Calendar</strong> in HH’s bottom navigation. Swipe up until you see the controls below the calendar, then tap <strong>Connect Google</strong>. If you see Google connected, your household is already connected.</p></li>
     <li><h3>Connect your existing Google account</h3><p>Tap <strong>Connect Google Calendar</strong>. On Google’s sign-in screen, tap the account you want to use and allow the calendar permission. Follow the prompts back to HH; if your phone leaves Google in another tab, return to HH and tap its refresh symbol.</p></li>
     <li><h3>Find your family calendar</h3><p>HH creates a calendar named after your household, ending in <strong>· Family</strong>. Existing events saved in HH are copied there. Everyone in your HH household can use it here without connecting Google separately.</p></li>
     <li><h3>Keep using HH or Google Calendar</h3><p>Use HH on your phone, or the Google Calendar app signed into the connected account. Save new family events to the calendar ending in · Family. Changes to that calendar sync with HH; tap HH’s refresh symbol to load the latest changes.</p></li>
    </Steps>
    <div className="tutorial-tip"><CalendarDays size={16}/><p><strong>Already have other Google calendars?</strong> HH syncs the family calendar it creates. Connecting your account does not automatically import, combine or subscribe to your other personal, work or shared calendars.</p></div>
    <h3 className="tutorial-subheading">Move an existing Google event into HH</h3>
    <p className="tutorial-copy-note">These steps work in the Google Calendar app on iPhone and Android. Use the same Google account that connected your HH family calendar.</p>
    <Steps>
     <li><h3>Open the event on your phone</h3><p>In the Google Calendar app, tap an event you organise, then tap the pencil to edit it.</p></li>
     <li><h3>Change its calendar</h3><p>Tap the calendar name below the event title. Select your HH calendar ending in <strong>· Family</strong>, then tap <strong>Save</strong> at the top right.</p></li>
     <li><h3>Return to HH</h3><p>Tap <strong>Calendar</strong> along the bottom and tap the refresh symbol. Find the event on its date, tap it, then tap <strong>Edit</strong> to choose family tags or an HH reminder.</p></li>
    </Steps>
    <p className="tutorial-copy-note">Moving takes the event out of its previous calendar. You must organise the event and be able to edit the destination calendar. Moving a repeating event also moves its future occurrences. If you want to keep the original where it is, add a separate matching event directly in HH instead; those two events will not stay linked.</p>
    <p className="tutorial-copy-note">Automatic syncing of an entire existing calendar into HH isn’t available yet.</p>
    <div className="tutorial-phone-links"><a className="text-button tutorial-source" href="https://support.google.com/calendar/answer/78739?co=GENIE.Platform%3DiOS&amp;hl=en" target="_blank" rel="noopener noreferrer">Google’s iPhone guide <ArrowUpRight size={14}/></a><a className="text-button tutorial-source" href="https://support.google.com/calendar/answer/78739?co=GENIE.Platform%3DAndroid&amp;hl=en" target="_blank" rel="noopener noreferrer">Google’s Android guide <ArrowUpRight size={14}/></a></div>
    <details className="tutorial-extra"><summary>Copy a whole Google calendar at once</summary>
     <span className="tutorial-role">Computer needed for this one-time import · Use your phone again afterward</span>
     <p className="tutorial-copy-note">Connect HH to Google first using the steps above. You can then copy existing events in bulk into the family calendar.</p>
     <Steps>
      <li><h3>Export your existing calendar</h3><p>On a computer, open Google Calendar using the account with your existing events. Click the gear icon, choose <strong>Settings</strong>, then open <strong>Import &amp; export</strong> and choose <strong>Export</strong>.</p></li>
      <li><h3>Find the calendar file</h3><p>If the download is a ZIP, unzip it. Each calendar has its own <strong>.ics</strong> file. Choose the calendar you want to bring over.</p></li>
      <li><h3>Import into your HH family calendar</h3><p>Switch to the Google account connected to HH if needed. Open <strong>Settings → Import &amp; export</strong>. Select the .ics file and change the destination to your calendar ending in <strong>· Family</strong>, then choose <strong>Import</strong>. Repeat for other calendar files you want to add.</p></li>
      <li><h3>Go back to HH on your phone</h3><p>Tap <strong>Calendar</strong> along the bottom and tap the refresh symbol. Look on the imported events’ dates to see them.</p></li>
     </Steps>
     <div className="tutorial-tip"><CalendarDays size={16}/><p><strong>This is a one-time copy.</strong> The original calendar stays separate. Later changes there will not update these copies. Use the HH family calendar for plans going forward; changes to that calendar sync with HH.</p></div>
     <p className="tutorial-copy-note">Google does not import guest lists or video-meeting details.</p>
     <div className="tutorial-phone-links"><a className="text-button tutorial-source" href="https://support.google.com/calendar/answer/37111?hl=en" target="_blank" rel="noopener noreferrer">Google’s export guide <ArrowUpRight size={14}/></a><a className="text-button tutorial-source" href="https://support.google.com/calendar/answer/37118?hl=en" target="_blank" rel="noopener noreferrer">Google’s import guide <ArrowUpRight size={14}/></a></div>
    </details>
    <details className="tutorial-extra"><summary>Google needs reconnecting?</summary><p>The household owner taps <strong>Calendar</strong> in the bottom navigation, swipes up to the controls below the calendar, and taps <strong>Reconnect Google</strong>. Use the same Google account that originally connected the family calendar.</p></details>
    <button type="button" className="text-button tutorial-action" onClick={onCalendar}>Open Calendar <ArrowUpRight size={16}/></button>
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon tutorial-gold"><Smartphone size={22}/></span><span><small>04 · SAFARI &amp; HOME SCREEN</small><h2>Put HH on your iPhone</h2><p>Your family’s home, one tap away.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">iPhone · Safari · Add it on each person’s phone</span>
    <p className="tutorial-copy-note">This adds HH as a web app (PWA), with its own Home Screen icon.</p>
    <div className="tutorial-address"><span>HH website address</span><code>{appAddress}</code><button type="button" className="text-button" onClick={async()=>{try{await navigator.clipboard.writeText(appAddress);setCopyNotice('Website address copied. Paste it into Safari’s address bar.')}catch{setCopyNotice('Touch and hold the website address above to copy it.')}}}><Copy size={15}/>Copy website address</button>{copyNotice&&<p role="status">{copyNotice}</p>}</div>
    <Steps>
     <li><h3>Open HH in Safari</h3><p>Open Safari on your iPhone and paste the HH address above into its address bar. Use Safari itself if you arrived through an email or social app.</p></li>
     <li><h3>Open Safari’s Share menu</h3><p>Tap the square with an upward arrow. Depending on your Safari layout, first tap the menu or More button, then <strong>Share</strong>.</p></li>
     <li><h3>Tap Add to Home Screen</h3><p>Scroll down the Share menu and tap <strong>Add to Home Screen</strong>.</p></li>
     <li><h3>Add the HH icon</h3><p>Keep the name HH. Leave <strong>Open as Web App</strong> on if it is shown, then tap <strong>Add</strong>.</p></li>
     <li><h3>Open HH from your Home Screen</h3><p>Tap the new HH icon. Sign in with your existing account if asked.</p></li>
    </Steps>
    <details className="tutorial-extra"><summary>Can’t find Add to Home Screen?</summary><p>Scroll to the bottom of Safari’s Share menu, tap <strong>Edit Actions</strong>, and add <strong>Add to Home Screen</strong>. Then try again.</p></details>
    <div className="tutorial-tip"><Check size={16}/><p><strong>Want reminder notifications?</strong> Open HH from its Home Screen icon, tap your initials in the top right corner, find <strong>Notifications</strong>, then tap <strong>Enable notifications</strong> and allow the request. Tap <strong>Send a test</strong> to check it. Each person enables their own phone.</p></div>
    <a className="text-button tutorial-source" href="https://support.apple.com/en-ca/guide/iphone/iphea86e5236/ios" target="_blank" rel="noopener noreferrer">Apple’s Safari installation guide <ArrowUpRight size={14}/></a>
   </div>
  </details>
 </section>
}
