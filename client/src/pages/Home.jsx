import Workspace from './Workspace'

export default function Home() {
  return (
    <Workspace
      placeholder="Ask NOMI to find an email, draft a reply, or manage your calendar…"
      emptyTitle="Your NOMI workspace is ready"
      emptyBody="Ask about your email or your calendar in plain language — NOMI will handle the rest, with your approval at each step."
      suggestions={[
        'What\'s on my calendar today?',
        'Find my unread emails from this week',
      ]}
    />
  )
}
