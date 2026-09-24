import Workspace from './Workspace'

export default function Calendar() {
  return (
    <Workspace
      workspaceType="calendar"
      conversationId="calendar"
      placeholder="Ask about your schedule, or create an event…"
      emptyTitle="No calendar events found"
      emptyBody="Ask NOMI what's on your schedule, or have it create a new event."
      suggestions={[
        'What\'s on my calendar tomorrow?',
        'Create a meeting tomorrow at 2pm',
      ]}
    />
  )
}
