# Project board

The board shows one project's threads as cards in columns, so you can see what
each piece of work is doing and where it stands. Each card is one thread.

## Open a board

On web and desktop, select **Projects** at the top of the sidebar, or choose
**Open projects** in the command palette. Projects shows each repo as a card
with its description, the thread you last worked in, and when. Select a card
to open that project's board, and select **Projects** at the top of a board to
go back.

To skip the grid, choose **Open board** in the command palette or press
`Cmd+Alt+K` (`Ctrl+Alt+K` on Windows and Linux). The board opens for the project
of the thread you are viewing. In the sidebar's project filter, the board button
on a project row opens that project's board.

The description comes from the repo's `package.json`, or the first paragraph of
its README.

### Project tabs

To focus on boards, turn on **Project tabs** in Settings > General, or choose
**Switch projects with tabs** in the command palette. The sidebar is hidden and
each open project becomes a tab above its board. **+** opens Projects to add a
tab, and the gear opens Settings. Closing a tab lets its live card go warm.
Turn the setting off, or choose **Show the sidebar instead of project tabs** in
the command palette, to bring the sidebar back.

Boards need an environment running a Supadesign server that supports them. The
board entries are hidden when no connected environment does.

## Cards

New threads land in the inbox column, marked with an inbox icon. Drag a card to
reorder it or move it to another column. Order within a column is kept. On
touch screens and narrow windows, use the card's **…** menu and **Move to**.

Double-click a card or press **Enter** to open its thread. Press **Escape** in
that thread to return to the board where you left it. Escape does nothing while
the composer holds a draft, or while a terminal, preview, menu, or dialog has
focus.

With a card focused, the arrow keys, **Home**, and **End** move between cards.
`Cmd+Arrow` (`Ctrl+Arrow` on Windows and Linux) moves the focused card up, down,
or to the neighboring column. Customize `board.open`, `board.back`, and the
`board.card.move…` commands in **Settings → Keybindings**.

## Done archives

Moving a card into the done column archives its thread, and moving it back out
unarchives it. A thread that is still working can't be moved to done until you
stop it. Done is collapsed at first; select **Show archived** to load its cards.

## Columns

Use a column's **…** menu to rename it, move it left or right, or choose which
column is the inbox or done. Double-click a column's name to rename it, and use
**Add column** at the end of the board for a new one.

Deleting a column moves its cards to the column on its left, or to the right for
the first column. The done column can't be deleted, and the inbox must move to
another column first.

## Live preview

One column can be the live preview column, marked **Live**; set it from a
column's **…** menu. Supadesign runs a dev server for one card in that column at
a time, so you can try the work without leaving your laptop running a server for
every task:

- On the board, the column's top card is live. Drag a card to the top to test it.
- Opening a card from the column makes that card live while you are in it.

A live card shows a link to its local dev server; the opened thread shows the
same link in its header. The card runs the thread's own worktree when it has
one, otherwise a worktree checked out at its linked pull request, otherwise the
project folder. A worktree created for a pull request first runs the project's
setup script.

When a card stops being live it stays **warm** for 10 minutes, so switching
between cards doesn't restart their servers. **Stop now** ends it early. Moving
a card out of the column, or to done, stops it right away and removes a worktree
created for it unless it has changes.

The first time a project goes live, Supadesign works out how to start it in the
card's own checkout. When the project's scripts make it clear, including an app
one folder down, it just starts. Otherwise a temporary setup agent, using your
text generation model (Settings > Providers), explores the repo, reports the
command, and is removed; **Watch** on the card shows its work. The command is
saved as the project's **Dev server** action, which you can change in the
project's action settings. If a command it picked crashes, an agent gets one
chance to correct it. Only when it can't tell does the card ask you for the
command, and it says why.

If the server fails to start, the card shows why and its last output. **Retry**
first has an agent check whether the command itself is wrong, then starts the card again.
