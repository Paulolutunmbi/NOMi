export const ACTION_LABELS = {
  'gmail.search': 'search Gmail',
  'gmail.read': 'read a Gmail message',
  'gmail.draft': 'create a Gmail draft',
  'gmail.send': 'send a Gmail message',
  'gmail.draft.reply': 'create a reply draft',
  'gmail.send.reply': 'send a reply',
  'gmail.draft.edit': 'update the draft',
  'gmail.draft.update': 'update the draft',
  'gmail.markRead': 'mark messages as read',
  'gmail.search_then_reply': 'find the conversation and draft a reply',
  'gmail.search_then_draft_reply': 'find the conversation and draft a reply',
  'gmail.search_then_send_reply': 'find the conversation and send a reply',
  'calendar.search': 'look at your calendar',
  'calendar.read': 'open a calendar event',
  'calendar.create': 'create a calendar event',
  'calendar.update': 'update a calendar event',
  'calendar.delete': 'delete a calendar event',
  'calendar.freebusy': 'check your availability',
}

export const PERMISSION_DESCRIPTIONS = {
  'gmail.search': 'Search your Gmail',
  'gmail.read': 'Read your Gmail messages',
  'gmail.draft': 'Create Gmail drafts',
  'gmail.send': 'Send email on your behalf',
  'gmail.draft.reply': 'Create Gmail reply drafts',
  'gmail.send.reply': 'Send replies on your behalf',
  'gmail.draft.update': 'Update Gmail drafts',
  'gmail.markRead': 'Mark Gmail messages as read',
  'calendar.search': 'Look up calendar events',
  'calendar.read': 'Read calendar event details',
  'calendar.freebusy': 'Check your availability',
  'calendar.create': 'Create calendar events',
  'calendar.update': 'Update calendar events',
  'calendar.delete': 'Delete calendar events',
}

export function friendlyAction(action) {
  return ACTION_LABELS[action] || action
}

export function friendlyPermission(action) {
  return PERMISSION_DESCRIPTIONS[action] || action
}
