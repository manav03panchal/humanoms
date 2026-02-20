# Task-Linked Daily Reminders (Discord)

## Problem

No way to get pinged about a task at a set time daily until it's completed. Automations fire forever — no awareness of task lifecycle.

## Design

### Schema

```sql
ALTER TABLE automations ADD COLUMN linked_task_id TEXT REFERENCES tasks(id);
```

### Auto-disable on completion (two enforcement points)

**1. `complete_task` tool (proactive)**

When a task is marked completed, scan `automations` for any with `linked_task_id = task_id`. For each:
- Set `enabled = 0`
- Call `scheduler.unschedule(automation_id)`

**2. Scheduler pre-check (defensive)**

Before firing any automation with a `linked_task_id`, query the task's status. If `completed`:
- Set `enabled = 0`, skip firing
- Covers edge cases (task completed via API, direct DB, etc.)

### New tool: `send_notification`

Standalone chat tool for workflows to send Discord messages.

```typescript
tool("send_notification", "Send a notification to configured channels", {
  title: z.string(),
  message: z.string(),
  level: z.enum(["info", "warning", "error", "success"]).default("info"),
  task_id: z.string().optional(), // auto-enriches with task details
});
```

When `task_id` is provided, the notification includes task title, status, due date, and days overdue.

### UX flow

```
User: "Remind me about 'Fix auth bug' every day at 9am until it's done"

AI creates:
  1. Workflow (1 step): send_notification → Discord ping with task context
  2. Automation: cron="0 9 * * *", workflow_id=above, linked_task_id=task-123

Daily 9am → scheduler checks task status → still pending → fires → Discord ping
User completes task → complete_task disables automation → no more pings
```

### Multiple reminders per task

Supported. Example: 9am nudge + 5pm nag, both linked to same task. Both auto-disable on completion.

## Implementation steps

1. `ALTER TABLE automations ADD COLUMN linked_task_id TEXT REFERENCES tasks(id)`
2. Update `create_automation` tool — accept optional `linked_task_id`
3. Update `update_automation` tool — allow setting/clearing `linked_task_id`
4. Scheduler: add pre-fire check for linked task status
5. `complete_task` tool: add post-completion scan to disable linked automations
6. Add `send_notification` tool (uses existing `NotificationDispatcher`)
7. Update system prompt to document the reminder pattern
