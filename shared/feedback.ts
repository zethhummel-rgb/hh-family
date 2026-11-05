export const feedbackAreas = ['Home dashboard','Calendar','Groceries','To Do & Reminders','Meal planner','Family notes','Week overview','Household & invitations','Notifications','Appearance & settings','Sign-in & accounts','Other / General feedback','New Feature Suggestion'] as const;
export type FeedbackArea = typeof feedbackAreas[number];
export const feedbackRecipient = 'hummelhomeapp@gmail.com';
export const feedbackLimit = 5000;
export function validFeedbackArea(value:unknown):value is FeedbackArea {return typeof value==='string'&&feedbackAreas.some(area=>area===value)}
