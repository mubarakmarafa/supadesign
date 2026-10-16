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

Click a card to open its thread in a side peek beside the board, where you can
read it and send a quick message. Click an empty part of the board, press
**Escape**, or close the peek to go back to just the board. Peeking doesn't change which card is live. Double-click a
card, press **Enter**, or use the peek's expand button to open its thread. Press **Escape** in
that thread to return to the board where you left it. Escape does nothing while
the composer holds a draft, or while a terminal, preview, menu, or dialog has
focus.

With a card focused, the arrow keys, **Home**, and **End** move between cards.
`Cmd+Arrow` (`Ctrl+Arrow` on Windows and Linux) moves the focused card up, down,
or to the neighboring column. Customize `board.open`, `board.back`, and the
`board.card.move…` commands in **Settings → Keybindings**.

## Bank messages for later

Context rarely arrives in one go. Press **Option+Enter** (`Alt+Enter` on Windows
and Linux) in a card's composer to bank what you wrote, with its images, files,
and annotations, instead of sending it. Banked messages sit above the composer
under **Banked**, where you can read, edit, reorder, and remove them, and the
card shows how many it holds. **Send all** sends them to the agent as one
message, in order.

To send a card's bank by moving it, choose **Send banked messages here** from a
column's **…** menu. Moving a card with banked messages into that column sends
them and starts its agent. Banked messages are kept by the server, so they
follow the card to your other devices.

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
same link in its header. Clicking it opens the card's thread with the running
app in the in-app preview beside the chat; the arrow button beside it opens the
system browser instead. The card runs the thread's own worktree when it has
one, otherwise a worktree checked out at its linked pull request. A card on a
branch runs the project folder when it is on that branch, otherwise a worktree
of the branch beside it; the project folder's branch is never switched. A
worktree created for a pull request or branch first runs the project's setup
script.

When a card stops being live it stays **warm** for 10 minutes, so switching
between cards doesn't restart their servers. **Stop now** ends it early. Moving
a card out of the column, or to done, stops it right away and removes a worktree
created for it. A worktree with changes is kept instead: the card says so, and
**Discard changes** removes it.

After Supadesign restarts, the card that was live shows **Stopped** rather than
starting by itself; **Start** runs it again.

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

## Design mode

In the in-app preview, press **Cmd+Shift+D** (`Ctrl+Shift+D` on Windows and
Linux) or the design mode button to mark up the page. **Box**, **Circle**,
**Arrow**, and **Pen** draw on the page, **Select** picks elements, and
**Erase** removes a mark. Choosing a drawing tool freezes the page, so your
marks stay on the frame you reviewed even if the app reloads; **Frozen**
returns to the live page. Write a comment beside your marks and press **Attach**:
the screenshot and comment go into the composer as one item, and design mode
stays on for the next mark. **Escape** leaves design mode. Design mode is
available in the desktop app.
