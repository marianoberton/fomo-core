# RBAC Debt — Routes Without `:projectId`

These routes perform write operations but lack a `:projectId` param in the path, making it impossible to apply `requireProjectRole` (which needs `projectId` to look up the caller's membership). They are intentionally **out of scope** for the L9 RBAC sprint.

## Why they're excluded

`requireProjectRole` resolves the project from `request.params.projectId` (with fallback to `request.params.id`). Routes below have neither, so there's no project context to check membership against. Callers are implicitly trusted because they already hold a valid API key (either master or project-scoped).

---

## Scheduled Task lifecycle routes (no `:projectId`)

| Method | Path | Write action |
|--------|------|-------------|
| PATCH  | `/scheduled-tasks/:id/agent` | Change executor agent |
| POST   | `/scheduled-tasks/:id/approve` | Approve task |
| POST   | `/scheduled-tasks/:id/reject` | Reject task |
| POST   | `/scheduled-tasks/:id/pause` | Pause task |
| POST   | `/scheduled-tasks/:id/resume` | Resume task |
| POST   | `/scheduled-tasks/:id/trigger` | Manually trigger run |

**Mitigation**: The `GET /scheduled-tasks/:id` handler validates the task exists; callers need a valid API key. Consider adding a task-to-project lookup + RBAC check in a future sprint.

---

## Approval lifecycle routes (no `:projectId`)

| Method | Path | Write action |
|--------|------|-------------|
| POST   | `/approvals/:id/approve` | Approve tool call |
| POST   | `/approvals/:id/reject` | Reject tool call |

**Mitigation**: Approvals are looked up by ID; the approval itself carries `projectId` internally. Future fix: load approval, extract `projectId`, then call `requireProjectRole`.

---

## Prompt-layer activate route (no `:projectId`)

| Method | Path | Write action |
|--------|------|-------------|
| POST   | `/prompt-layers/:id/activate` | Activate a prompt layer version |

**Mitigation**: Layer carries `agentId` → `projectId` chain; future fix requires a join.

---

## Agent routes without `:projectId`

| Method | Path | Write action |
|--------|------|-------------|
| POST   | `/agents/:agentId/sessions` | Create session |

**Note**: `POST /sessions` is explicitly excluded per sprint rules (public inbound channel entry point).

---

## Contact routes without `:projectId`

| Method | Path | Write action |
|--------|------|-------------|
| PUT    | `/contacts/:id` | Update contact |
| DELETE | `/contacts/:id` | Delete contact |

**Mitigation**: Contact carries `projectId`; future fix requires loading the record first.

---

## Platform bridge routes (admin-scoped)

All routes in `src/api/routes/platform-bridge.ts` are already protected by `adminAuth` middleware (Fomo-internal token). RBAC not applicable.

---

## Session-related routes

`POST /sessions` — excluded by sprint rule (public inbound entry point for channel messages).

---

## How to fix in a future sprint

For routes where the resource carries a `projectId` internally:

```ts
// Pattern: load resource → extract projectId → check role
const task = await taskManager.getTask(taskId);
if (!task) { return sendNotFound(...); }
await requireProjectRole('operator', deps)(
  { ...request, params: { projectId: task.projectId } } as FastifyRequest,
  reply,
  done,
);
```

Or refactor paths to nest under `/projects/:projectId/...` where feasible.
