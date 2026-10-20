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

Opening a project, from the command palette, a new or cloned project, or when the app starts,
shows its board. Start its first card there.

Boards need an environment running a Supadesign server that supports them. The
board entries are hidden when no connected environment does.

## Workspace

A board is also a workspace: you can place widgets beside the cards and give
each project its own look. A new board starts with the board agent beside the
cards.

Select **Add widget** at the top of the board to add:

- **Board agent**: a chat that runs the board for you. Select **Start the
  board agent**, then tell it your ideas and it adds them as cards, hands work
  to cards so their own agents start, and moves cards between columns. It
  doesn't change the project's files itself. Its thread is listed with the
  project's threads but never shows as a card, and removing the widget keeps
  the conversation for when you add it back.
- **Live preview**: the live card's dev server, with its branch. Its menu
  switches to another server that is already running, with this project's own
  servers listed first. It never starts a server; when nothing is live it shows
  the project's most recently active one, including a server a card's agent
  started itself in the project folder or the card's worktree.
- **Figma**: paste a figma.com file, design, or prototype link to keep the
  design goal next to the live preview.
- **Usage**: tokens and spend for today and the last 7 days, plus plan limits.
  These cover every project on the environment, not just this one.
- **Git**: the project folder's branch and uncommitted changes, its local
  branches, and its open pull requests.
- **Board**: the cards themselves, if you removed them.

Widgets are tiles that always fill the board, up to five at a time so
everything stays on one screen. Adding a widget splits the biggest tile.

- **Resize**: drag the gap between two tiles. One grows as its neighbour
  shrinks, and edges snap to an even grid so they line up. Double-click a gap
  to make the tiles beside it equal.
- **Move**: drag a tile by its title bar. Drop it on the middle of another tile
  to swap the two, on another tile's edge to split that tile, or on the board's
  outer edge to run it along that whole side. Esc cancels.
- **Maximize**: double-click a title bar, or use its **…** menu, to fill the
  board with one tile. Esc or the restore button puts it back. This only
  changes the device you're on.
- **Even out sizes** and **Reset layout** are in the **Add widget** menu.
  Removing a widget from its **…** menu can be undone from the notice that
  appears.

With the keyboard, Tab to a gap and use the arrow keys to resize, or focus a
title bar and press Alt+Arrow to move to the next tile and Alt+Shift+Arrow to
swap with it. In a narrow window the tiles stack and scroll.

Select the palette button next to **Add widget** to set the project's
background (a tint, a gradient, your own colour, or an image link) and an
accent colour. The accent also marks the project's tab, so you can tell which
project you are in at a glance. **Reset look** goes back to the plain board.

The workspace is saved with the project, so it looks the same on every device
connected to that environment.

## Cards

New threads land in the inbox column, marked with an inbox icon. To jot down
work before starting it, select **+** on a column and write what you want to
work on: the first line is the card's title and the rest its summary. **Enter**
adds the card and leaves room for the next one; **Shift+Enter** starts a new
line. The card says **Not started** until you send it something. Its note waits
in the card's composer, so opening it and pressing **Enter** starts the agent.
A card added to the live preview column goes under the live card, so it doesn't
change what is running.

Drag a card to
reorder it or move it to another column. Order within a column is kept. On
touch screens and narrow windows, use the card's **…** menu and **Move to**.

Click a card to open its thread in a window over the board, where you can read
it and send a quick message. Click outside the window, press **Escape**, or
close it to go back to the board. Peeking doesn't change which card is live.
Double-click a card, press **Enter**, or select **Open full thread** in the
window to open its thread. To return to the
board where you left it, select the project name with the back arrow at the top of the thread,
or press **Escape**. Escape does nothing while the composer holds a draft, or while a terminal,
preview, menu, or dialog has focus.

To get rid of a card, right-click it or open its **…** menu and choose
**Delete thread**. This permanently deletes the thread and its history; to keep
it, move the card to done instead.

Under its title a card shows a short summary of the thread. Its agent keeps the
summary current; until it writes one, the card shows the thread's goal or its
first message. Choose **Edit summary…** from the card's **…** menu to write your
own; your summary stays until you clear it with **Let the agent write it**.

With a card focused, the arrow keys, **Home**, and **End** move between cards.
`Cmd+Arrow` (`Ctrl+Arrow` on Windows and Linux) moves the focused card up, down,
or to the neighboring column. Customize `board.open`, `board.back`, and the
`board.card.move…` commands in **Settings → Keybindings**.

Agents can use the board too. Ask one to add cards for ideas, or to move its
card to another column, and it does what the same drag would: moving to done
archives, moving to the send column sends banked messages, and moving out of
the live preview column stops the card's server. A move into or out of a column
with automations runs them too. Cards an agent adds wait unstarted, like
yours. An agent can also bank a message on a card, which waits with the
card's other banked messages without starting its agent.

## Progress images

A card's cover is a screenshot of its running app, so you can see where the
work is without opening it. Images arrive three ways:

- The agent publishes one when there is something worth reviewing, with a note
  on what changed and any questions it wants you to decide. A card with
  questions shows how many under its summary.
- After each of the agent's turns on the live card, Supadesign captures it.
- **Capture progress now** in the card's **…** menu, or **Capture** in the
  thread's header, captures the live card right away.

A card that isn't live keeps its last image. When the agent has worked since
that image was taken, the cover says **Out of date**; if a capture fails, the
card keeps its last image and says why.

The expand button on a cover, the question count, **View progress** in the
card's menu, and the thumbnail in the thread's header all open the card's
images, newest first. **Reply with this image** puts the image into the
thread's composer so you can comment on exactly what you saw.

## Bank messages for later

Context rarely arrives in one go. Press **Option+Enter** (`Alt+Enter` on Windows
and Linux) in a card's composer to bank what you wrote, with its images, files,
and annotations, instead of sending it, or select the bank button beside send.
The composer's placeholder shows the shortcut. Banked messages sit above the composer
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
column is the inbox or done. Double-click a column's name to rename it. **Add
column** at the end of the board asks for a name and what the column does, the
same choices as **Column settings…** in the column's menu.

Deleting a column moves its cards to the column on its left, or to the right for
the first column. The done column can't be deleted, and the inbox must move to
another column first.

## Column automations

A column can send prompts to a card's agent when the card moves in or out, so
moving work along the board does the routine work for you: open a pull request,
merge into main, delete the branch, audit the changes, or turn banked notes into
a plan. Open **Column settings…** from a column's **…** menu and use **Add
step** under **When a card arrives** or **When a card leaves**. Each step starts
from a preset you can rename and rewrite, or from a blank **Custom step**. A
column with automations shows a lightning mark; hover it to see what runs.

- Each prompt goes to the card's own thread, which already knows its branch and
  work, and waits behind anything the agent is doing. A step runs on the card's
  model unless you turn off **Use the card's model** and pick another one and its
  effort; a quick, inexpensive model is usually enough for routine steps.
- Prompts can mention `{card}`, `{branch}`, `{column}`, and `{from}`.
  `{banked}` puts in the card's banked messages and sends them along; a step
  that uses it is skipped when nothing is banked.
- A moved card waits five seconds before anything is sent, with a countdown on
  the card and a toast. **Cancel** stops it and **Run now** skips the wait.
  Moving the card again in those seconds counts as one move from where it
  started, so dragging it back runs nothing.
- Done archives its cards, so it can't have automations, and nothing runs on a
  card moved there. Put steps such as merging in a column before Done.

The agent reports back when it's finished, and the card shows how it went:

- **Done**, with the agent's note. If the column's settings say **When the
  agent reports them done: Move it to …**, the card moves there by itself, so a
  "Ship" column that merges can send the card straight to Done.
- **Needs you**, with what's blocking it, such as a merge conflict. The card
  stays put; use **Open thread** to sort it out, then **Run again**.
- **Finished without a report** when the agent stopped without saying. Check
  the thread, then **Move to …** or **Dismiss**.

**Run this column's steps again** in a card's **…** menu re-sends the column's
arrival steps without moving the card. A board that keeps passing a card along
on its own stops after three automatic moves in a row and asks you to move it.

Agents that move cards trigger automations the same way you do.

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
a card out of the column, or archiving it anywhere, stops it right away and
removes a worktree created for it. Servers the card's agent started itself in
the card's worktree stop with it, unless the agent is still working. A worktree
with changes is kept instead: the card says so, and **Discard changes** removes
it. If a card's worktree folder was deleted, going live checks its branch out
there again.

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

If the server fails to start, the card and the Live preview widget show why,
and the card shows its last output. **Retry** first has an agent check whether
the command itself is wrong, then starts the card again. A setup script or
server that seems stuck can be restarted with **Start over**; a setup script
still running after 15 minutes is stopped.

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
