import fs from 'node:fs';
const files=["schema.sql", "calendar.sql", "google_calendar.sql", "calendar_integrity.sql", "member-colours.sql", "push-reminders.sql", "recurring-reminders.sql", "reminder-completion-guard.sql", "pilot.sql", "invitation-email.sql", "pilot-seven-spots.sql", "native-calendar-repeats.sql", "event-notification-toggle.sql", "pilot-fourteen-spots.sql", "admin-households.sql", "self-service-deletion.sql", "household-reminder-jobs.sql"];
let sql='-- HH fresh project only. No accounts, events, credentials, or production data are included.\nbegin;\n';
for(const file of files)sql+='\n-- '+file+'\n'+fs.readFileSync(new URL('../database/'+file,import.meta.url),'utf8')+'\n';
sql+='\ncommit;\n';fs.mkdirSync(new URL('../supabase/',import.meta.url),{recursive:true});fs.writeFileSync(new URL('../supabase/bootstrap.sql',import.meta.url),sql);console.log('Fresh-project bootstrap prepared.');
