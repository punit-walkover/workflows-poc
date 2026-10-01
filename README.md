# Workflows POC

A proof of concept for Ticket0 **workflows** (Chatbase-style procedures):

- **Builder**: clients write steps in plain English, with `@action` chips, `{{variable}}` chips, If / Else if / Else branches nested up to 2 levels, and **Go to step** (jump back to an earlier step, at most 1-5 times). The limit is 15 steps. Drafts are saved; publishing freezes a version.
- **Durable runner**: a DBOS workflow walks the published tree one node at a time. GTWY decides each node (JSON answer) and our code runs the actions. An action marked **Needs approval** waits for a teammate.
- **Playground**: chat as the customer or reply as the team. Every message is labelled **Customer**, **AI** or **Team**. Chats waiting on an approval show a pulsing red dot; open one and approve right in the chat. The right-hand panel has pause/resume/cancel/retry, the step tree, the event timeline and the raw DBOS checkpoints.
- **Chatbot embed** (`/chatbot`): one `<script src=".../widget.js">` tag puts the same agent in any product. `/embed-demo` is a fake store page with it pasted in; widget chats show up in the Playground with a *widget* badge.

```
workflows-poc/
  server/   NestJS 12 + DBOS 5 + pg + gtwy-sdk   → http://localhost:4001
  web/      Next.js 16 + Tailwind 4 + TipTap 3   → http://localhost:4000
```

## Run it

Needs the local Postgres used by ticket0-b. `server/.env` was generated from `ticket0-b/.env` (same Postgres credentials, database `workflows_poc`; same GTWY org, folder and key).

```bash
cd workflows-poc/server && npm install && npm run db:setup && npm run dev
cd workflows-poc/web && npm install && npm run dev
```

Or use the `workflows-poc-server` / `workflows-poc-web` entries in `.claude/launch.json`.

- On first boot the server publishes two templates: **Order refund** and **Damaged item return**.
- It also creates its own GTWY agent, stored in `app_setting`.
- `npm run smoke -- damaged|approval|escalate|sheets` drives a full conversation through the API.

## Demo scenarios (mock shop)

| Customer | Say | What happens |
| --- | --- | --- |
| Alex (alex@example.com) | "My headphones arrived cracked, I want a refund." Then `4512`, then attach a photo | The photo waits for approval, then the refund ($79.99) waits for approval too (`refund_order` needs approval) |
| Sam (sam@example.com) | "Refund my blender please, order 4600." | The refund waits for approval (red dot in the Playground), then runs in `approved` mode |
| Alex | "I want my money back for order 4513." | Delivered 45 days ago, so the run is **escalated** to a human |
| Jo (jo@example.com) | "Order 4700, refund the kettle, it leaks." | $45.00 item refund after approval; the shop refuses anything above what's refundable |

**Reset refunds** (Playground empty state) undoes refunds so scenarios can be replayed. The waits are shortened for demos: reminder after 2 min, expiry after 10 min, approval timeout 30 min (see `.env`).

## How it works

- **Loop** (`server/src/runner/workflow.ts`): `decide → act → advance → flush`, then `DBOS.recv('signal')`, then `apply`. Every call is a checkpointed DBOS step, so a restart resumes at the last finished step without repeating model calls or refunds.
- **Signals** (`runner/run-control.ts`): customer messages, approvals, pause/resume/cancel/retry and timers all go through one state machine (`ALLOWED`), then `DBOS.send` with an idempotency key.
- **Routing** (`llm/decider.ts` `route` + `gate`): the model returns a workflow with a confidence. 0.7 or more starts it, 0.4-0.7 asks one clarifying question, below that the bot replies freely; a clear ask for a person hands over. Jev plugs in behind the same `route` port.
- **Approvals**: one flag per action, `requires_approval`. No policy engine, no approver teams: one shared inbox, any teammate decides.
- **Go to step** (`runner/steps.ts`): the jump clears outputs, chosen cases, attempts and collected answers from the target onward, marks the transcript so old answers don't count, and escalates with `loop_limit` past `max_visits`.
- **Conditions**: the model judges each condition true/false; code picks the first true case (else the Else case).
- **Exactly-once actions** (`actions/execute.ts`): `action_run.idempotency_key = <run>:<node>:<visit>` plus a row lock (a Go to step re-run is a new visit), so a crash mid-refund can't refund twice.
- **Audit**: `run_event` (the timeline) and `action_run` (every action, its mode and approval) answer "why was this refunded".

## Custom actions through viaSocket (Google Sheets first)

**Actions → Connected apps → Connect** opens viaSocket's consent popup.
- The server calls `findEnabled`/`enable` and stores the `script_id` AES-GCM-encrypted (`app_connection`).
- The POC is its own viaSocket end user (`VIASOCKET_UID=workflows-poc`) on ticket0-b's org and project.

**Set up demo sheet** (shown once Google Sheets is connected) does four things:
1. Creates an *Orders* spreadsheet in your Drive: orders 5001–5004, with a live `days_since_delivery` formula.
2. Creates `@sheet_lookup_order` (Lookup Spreadsheet Rows).
3. Creates `@sheet_refund_order` (Update Spreadsheet Row: `refunded_minor`, `refund_status`, `refund_reason`).
4. Publishes **Order refund (Google Sheets)** and turns the mock *Order refund* workflow off, so routing isn't ambiguous.

**New action** builder (`/actions/new`):
1. Pick an app. Any viaSocket app can be added by service id.
2. Pick an app action from viaSocket's catalogue.
3. Declare the arguments the AI fills.
4. Edit the input template (`inputData` with `{{args.name}}` placeholders). The fields panel loads live options (`listOptions`) and inserts values or argument references.
5. Set kind, subject and amount arguments, and whether it **needs approval**.
6. Save, then **Run test** with sample arguments.

**At runtime** a viaSocket action renders its template with the model's arguments and calls `runAction` inside the same `action_run` lock as the mock actions.

Smoke test after the demo setup: `npm run smoke -- sheets`.

Catalogue source: `POST https://flow.sokt.io/func/scriolZue69X {"service_id": …}` (as documented in `ticket0-b/docs/modules/ticket.md`). Google Sheets is `rowqm5xi2`.

## Differences from the real plan (POC shortcuts)

- Single tenant (no `org_id`); playground conversations stand in for tickets.
- A mock shop replaces viaSocket flows; files are stored on local disk.
- Timeline events live in Postgres `run_event` instead of Mongo `run_events`.
- Replies are sent automatically (no draft mode); no auth.
- GTWY chat uses the embed-login session token, because chat still rejects the raw embed JWT.
- Model: `gpt-6-luna` through GTWY (set `GTWY_MODEL`; gpt-4o-mini didn't follow the step rules reliably).
