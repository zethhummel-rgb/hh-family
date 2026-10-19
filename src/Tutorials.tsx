import {BookOpen,Mail,Users,CalendarDays,ArrowUpRight,Check} from 'lucide-react';
import './tutorials.css';

function Steps({children}:{children:React.ReactNode}){return <ol className="tutorial-steps">{children}</ol>}
export default function Tutorials({owner,onSettings,onCalendar}:{owner:boolean;onSettings:()=>void;onCalendar:()=>void}){
 return <section className="tutorials" aria-label="HH tutorials">
  <div className="tutorial-welcome"><BookOpen size={22}/><p>Three quick guides to get your household settled in. Open a guide and follow along at your own pace.</p></div>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><Mail size={22}/></span><span><small>01 · FAMILY ACCOUNTS</small><h2>Invite someone by email</h2><p>Give them their own login to your shared home.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner sends the invitation</span>
    <Steps>
     <li><h3>Open Household settings</h3><p>Tap your initials at the top right. On a computer, you can also use Household settings in the sidebar.</p></li>
     <li><h3>Enter their email address</h3><p>Find <strong>Invite a family member</strong>, enter the address they want to use, then choose <strong>Send invitation</strong>.</p></li>
     <li><h3>They open the invitation email</h3><p>They choose <strong>Join your household</strong>, then create an HH account or sign in with that exact email address. If asked, they confirm their email and return to the invitation.</p></li>
     <li><h3>They join your household</h3><p>They enter their name and choose <strong>Join household</strong>. Their own login opens the same family calendar, groceries and to-dos. They can pick their calendar colour in Household settings.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>One family, separate logins.</strong> Use Invite a family member for someone joining your home. “Invite another household” is for a different family creating its own separate home.</p></div>
    <details className="tutorial-extra"><summary>No invitation email?</summary><p>Check Spam and confirm the address is correct. The sender can use <strong>Copy invitation</strong> to share the link directly, or <strong>Retry email</strong> if delivery failed. Family invitations work once and expire after seven days. If a link expires or is lost, the owner can create a new invitation.</p></details>
    {owner?<button type="button" className="text-button tutorial-action" onClick={onSettings}>Open Household settings <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to send the invitation.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon tutorial-gold"><Users size={22}/></span><span><small>02 · LITTLE FAMILY MEMBERS</small><h2>Add a child without an email</h2><p>A family profile, with no account to set up.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">The household owner adds family profiles</span>
    <Steps>
     <li><h3>Open Household settings</h3><p>Tap your initials, then scroll to <strong>Family profiles</strong>.</p></li>
     <li><h3>Choose Add family profile</h3><p>Enter their name and choose their <strong>Calendar colour</strong>. No email address or password is needed.</p></li>
     <li><h3>Save their profile</h3><p>Choose <strong>Save profile</strong>. Their name and colour now appear with your household’s people.</p></li>
     <li><h3>Include them in family plans</h3><p>When adding or editing an event, select their name. Their coloured dot appears on the event, and the person filter helps you find their plans. Choose Everyone for a plan involving the whole family.</p></li>
    </Steps>
    <div className="tutorial-tip"><Check size={16}/><p><strong>A profile doesn’t sign in.</strong> You manage their plans from your own account. If they get an account later, invite them by email first. Then edit their existing family profile and use <strong>Link to an account</strong> to keep their event tags.</p></div>
    {owner?<button type="button" className="text-button tutorial-action" onClick={onSettings}>Add a family profile <ArrowUpRight size={16}/></button>:<p className="tutorial-owner-help">Ask your household owner to add the profile.</p>}
   </div>
  </details>
  <details className="tutorial-guide">
   <summary><span className="tutorial-icon"><CalendarDays size={22}/></span><span><small>03 · GOOGLE CALENDAR</small><h2>Connect Google &amp; bring your plans</h2><p>Use your existing Google account with HH.</p></span><span className="tutorial-expand" aria-hidden="true">+</span></summary>
   <div className="tutorial-body"><span className="tutorial-role">One Google connection per household · Owner connects</span>
    <Steps>
     <li><h3>Open the Calendar tab</h3><p>Scroll below the month calendar and choose <strong>Connect Google</strong>. If you see Google connected, your household is already connected.</p></li>
     <li><h3>Connect your existing Google account</h3><p>Choose <strong>Connect Google Calendar</strong>, select the Google account you want to use, and approve the calendar permission. Google returns you to HH.</p></li>
     <li><h3>Find your family calendar</h3><p>HH creates a calendar named after your household, ending in <strong>· Family</strong>. Existing events saved in HH are copied there. Everyone in your HH household can use it here without connecting Google separately.</p></li>
     <li><h3>Keep using HH or Google Calendar</h3><p>Changes to events in that family calendar sync between HH and Google. In Google, save new family events to this calendar. In HH, use the refresh symbol to load the latest changes.</p></li>
    </Steps>
    <div className="tutorial-tip"><CalendarDays size={16}/><p><strong>Already have other Google calendars?</strong> HH syncs the family calendar it creates. Connecting your account does not automatically import, combine or subscribe to your other personal, work or shared calendars.</p></div>
    <h3 className="tutorial-subheading">Bring an existing Google event into HH</h3>
    <Steps>
     <li><h3>Open Google Calendar on a computer</h3><p>Use the connected Google account and select an existing event.</p></li>
     <li><h3>Copy it to your HH family calendar</h3><p>Open the event’s <strong>Options</strong> menu, choose the family calendar as the copy destination, then save. For an event you own, you can instead edit it, change its calendar to the HH family calendar, and save to move it.</p></li>
     <li><h3>Refresh the calendar in HH</h3><p>Find the event on its date, then open it and choose <strong>Edit</strong> to set family tags or an HH reminder.</p></li>
    </Steps>
    <p className="tutorial-copy-note">Copying makes a separate event: later edits to the original do not update the copy. Moving changes which calendar holds the event. Available options depend on your Google permissions. Automatic syncing of an entire existing calendar into HH isn’t available yet.</p>
    <a className="text-button tutorial-source" href="https://support.google.com/calendar/answer/78739?co=GENIE.Platform%3DDesktop&amp;hl=en" target="_blank" rel="noopener noreferrer">Google’s guide to moving and copying events <ArrowUpRight size={14}/></a>
    <details className="tutorial-extra"><summary>Google needs reconnecting?</summary><p>The household owner opens Calendar, scrolls below the calendar, and chooses <strong>Reconnect Google</strong>. Use the same Google account that originally connected the family calendar.</p></details>
    <button type="button" className="text-button tutorial-action" onClick={onCalendar}>Open Calendar <ArrowUpRight size={16}/></button>
   </div>
  </details>
 </section>
}
