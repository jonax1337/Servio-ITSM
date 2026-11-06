// Full-height wrapper for the standalone Sable chat. The console <main> is
// `min-w-0 flex-1` inside a flex column (SidebarInset), so we fill the
// available height and hand a flex column to AssistantShell. Unlike other
// console pages this is a chat surface, not a scrolling document — the panes
// manage their own overflow.
export default function AssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div data-viewport-pane className="flex h-[calc(100svh-var(--topbar-h,3.5rem))] min-h-0 flex-1 flex-col lg:h-full">
      {children}
    </div>
  );
}
