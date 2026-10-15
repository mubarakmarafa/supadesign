# Automations

Automations send a prompt to an agent on a schedule. On web and desktop, open
**Automations** at the top of the sidebar or from the command palette. Customize
`automations.open` in **Settings → Keybindings** to give it a shortcut.

## Create an automation

Select **New automation**, then choose the environment it runs on, its project,
workspace, model, and prompt. An automation runs at fixed times or on an interval.
Fixed times use the environment's time zone, which may differ from your device's.
A fixed-time run more than ten minutes late, for example while the environment was
asleep, is skipped until its next time.

Automations an agent schedules post back into the agent's thread by default.
Other automations start a new thread each run.

## Manage automations

Use the project and environment pickers at the top of the page to see one
project's or one environment's automations. New automations start in that
selection. From a row you can pause or resume an automation, run it now, edit it,
open its thread, or delete it. **Run now** also works while an automation is
paused, and an interval restarts from that run.

**Sent** means Supaterm delivered the prompt, not that the agent finished. If the
automation's thread is still working, the prompt joins that turn.

## On mobile

Open **Settings → Scheduled tasks** to create recurring tasks or manage existing
ones across your connected environments. Use the settings filter to narrow the
list by environment or project. You can edit, pause, resume, run immediately, or
delete a task from the list. Leaving an edited form asks before discarding unsaved
changes.
