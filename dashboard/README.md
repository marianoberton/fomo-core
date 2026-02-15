# Nexus Core Dashboard

Web dashboard for monitoring and managing Nexus Core agents.

## Features

### 7 Core Views

1. **Overview** - Dashboard home with key metrics
   - Project count, active agents, active sessions
   - Pending approvals, today's cost, week's cost
   - Quick actions

2. **Projects** - List of projects with status (active/paused)
   - Project details: provider, budget limits
   - Created date, description

3. **Conversations** - Session history and messages
   - Filter by project and session
   - Message timeline with tool calls (expandable)
   - Real-time conversation viewing

4. **Contacts** - Contact management
   - Filter by project
   - Contact details: email, phone, organization
   - Card-based layout

5. **Approvals** - Pending approval requests
   - Approve/Reject buttons for high-risk tools
   - Filter: pending vs all
   - Tool input/output display
   - Budget warnings

6. **Usage & Costs** - LLM usage tracking
   - Total cost, total tokens, API calls
   - Budget progress bars (daily/monthly)
   - Detailed usage records table
   - Filter by project and period (day/week/month)

7. **Traces** - Execution timeline
   - List of traces by project
   - Event timeline with status
   - Token usage and cost per trace
   - Detailed event data (JSON)

## Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Lucide React
- **Date handling**: date-fns
- **API**: REST + WebSocket (connects to Nexus Core backend)

## Setup

1. Install dependencies (from root):
   ```bash
   pnpm install
   ```

2. Configure API URL:
   ```bash
   cd dashboard
   cp .env.local .env.local
   # Edit NEXT_PUBLIC_API_URL to point to your backend
   ```

3. Run development server:
   ```bash
   cd dashboard
   pnpm dev
   ```

4. Open [http://localhost:3001](http://localhost:3001)

## API Connection

The dashboard connects to the Nexus Core REST API at `/api/v1/*`:

- `GET /dashboard/overview` - Overview metrics
- `GET /projects` - List projects
- `GET /projects/:id/sessions` - Sessions by project
- `GET /sessions/:id/messages` - Message history
- `GET /projects/:id/contacts` - Contacts by project
- `GET /approvals` - Approval requests
- `POST /approvals/:id/approve` - Approve request
- `POST /approvals/:id/reject` - Reject request
- `GET /projects/:id/usage` - Usage records
- `GET /traces` - Execution traces
- `GET /traces/:id` - Trace detail
- `GET /projects/:id/prompt-layers` - Prompt layers
- `POST /prompt-layers/:id/activate` - Activate layer version

WebSocket endpoint:
- `WS /ws?projectId=<id>` - Real-time updates

## Development

```bash
# From dashboard directory
pnpm dev          # Start dev server
pnpm build        # Build for production
pnpm start        # Run production build
pnpm lint         # Run ESLint
```

## Production Deployment

The dashboard can be deployed to:
- Vercel (recommended)
- Netlify
- Any Node.js hosting platform
- Docker (build Next.js standalone)

Set `NEXT_PUBLIC_API_URL` to your production backend URL.

## Directory Structure

```
dashboard/
├── app/
│   ├── page.tsx                 # Overview
│   ├── projects/page.tsx        # Projects list
│   ├── conversations/page.tsx   # Sessions & messages
│   ├── contacts/page.tsx        # Contacts
│   ├── approvals/page.tsx       # Approvals
│   ├── usage/page.tsx           # Usage & Costs
│   ├── traces/page.tsx          # Execution traces
│   ├── prompts/page.tsx         # Prompt layers
│   ├── layout.tsx               # Root layout
│   └── globals.css              # Global styles
├── components/
│   └── nav.tsx                  # Navigation sidebar
├── lib/
│   ├── api.ts                   # API client functions
│   └── utils.ts                 # Utilities (cn, etc)
└── package.json
```

## Notes

- All data is fetched client-side (no SSR for now)
- Error states and loading states are handled
- Responsive design (mobile-friendly)
- Tool calls in conversations are expandable
- Prompt layer versions are immutable (activate old versions to rollback)
