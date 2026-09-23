import Workspace from './Workspace'

export default function Gmail() {
  return (
    <Workspace
      conversationId="gmail-workspace"
      placeholder="Search Gmail, draft a reply, or send a message…"
      emptyTitle="No conversations yet"
      emptyBody="Try asking NOMI to find a message or draft a reply to someone."
      suggestions={[
        'Find my unread emails from the last 7 days',
        'Reply to the last email from my manager',
      ]}
    />
  )
}
