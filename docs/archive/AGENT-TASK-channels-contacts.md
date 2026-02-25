# AGENT-TASK: feature/channels-contacts

## Scope
CORE 1 del Platform Roadmap — Channels + Contacts + Proactive Messaging

## Branch
```bash
git checkout -b feature/channels-contacts
```

## Deliverables

### 1. Contact Model (Prisma + Repository)

**File: `prisma/schema.prisma`** — Add Contact model:
```prisma
model Contact {
  id          String   @id @default(cuid())
  projectId   String   @map("project_id")
  
  name        String
  displayName String?  @map("display_name")
  
  phone       String?
  email       String?
  telegramId  String?  @map("telegram_id")
  slackId     String?  @map("slack_id")
  
  timezone    String?
  language    String   @default("es")
  metadata    Json?
  
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  
  project     Project  @relation(fields: [projectId], references: [id])
  sessions    Session[]
  
  @@unique([projectId, phone])
  @@unique([projectId, email])
  @@unique([projectId, telegramId])
  @@unique([projectId, slackId])
  @@map("contacts")
}
```

Also update Session model to add optional contactId:
```prisma
model Session {
  // ... existing fields
  contactId   String?  @map("contact_id")
  contact     Contact? @relation(fields: [contactId], references: [id])
}
```

**Run migration:**
```bash
npx prisma migrate dev --name add-contacts
```

**File: `src/contacts/types.ts`**
```typescript
import type { ProjectId } from '@/core/types.js';

export type ContactId = string;

export interface Contact {
  id: ContactId;
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateContactInput {
  projectId: ProjectId;
  name: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContactInput {
  name?: string;
  displayName?: string;
  phone?: string;
  email?: string;
  telegramId?: string;
  slackId?: string;
  timezone?: string;
  language?: string;
  metadata?: Record<string, unknown>;
}

export type ChannelIdentifier = 
  | { type: 'phone'; value: string }
  | { type: 'email'; value: string }
  | { type: 'telegramId'; value: string }
  | { type: 'slackId'; value: string };

export interface ContactRepository {
  create(input: CreateContactInput): Promise<Contact>;
  findById(id: ContactId): Promise<Contact | null>;
  findByChannel(projectId: ProjectId, identifier: ChannelIdentifier): Promise<Contact | null>;
  update(id: ContactId, input: UpdateContactInput): Promise<Contact>;
  delete(id: ContactId): Promise<void>;
  list(projectId: ProjectId, options?: { limit?: number; offset?: number }): Promise<Contact[]>;
}
```

**File: `src/infrastructure/repositories/contact-repository.ts`**
Implement ContactRepository using Prisma. Follow pattern from other repositories in same folder.

**File: `src/contacts/index.ts`** — Barrel file

---

### 2. Channel Types

**File: `src/channels/types.ts`**
```typescript
import type { ContactId } from '@/contacts/types.js';
import type { ProjectId, SessionId } from '@/core/types.js';

export type ChannelType = 'whatsapp' | 'telegram' | 'slack' | 'email';

export interface InboundMessage {
  id: string;
  channel: ChannelType;
  channelMessageId: string;
  projectId: ProjectId;
  
  // Sender info (raw from channel, before contact resolution)
  senderIdentifier: string;  // phone, telegram user id, slack user id, etc.
  senderName?: string;
  
  // Content
  content: string;
  mediaUrls?: string[];
  replyToChannelMessageId?: string;
  
  // Raw payload for debugging
  rawPayload: unknown;
  receivedAt: Date;
}

export interface OutboundMessage {
  channel: ChannelType;
  recipientIdentifier: string;  // phone, telegram chat id, slack channel, etc.
  
  content: string;
  mediaUrls?: string[];
  replyToChannelMessageId?: string;
  
  options?: {
    parseMode?: 'markdown' | 'html';
    silent?: boolean;
  };
}

export interface SendResult {
  success: boolean;
  channelMessageId?: string;
  error?: string;
}

export interface ChannelAdapter {
  readonly channelType: ChannelType;
  
  send(message: OutboundMessage): Promise<SendResult>;
  parseInbound(payload: unknown): Promise<InboundMessage | null>;
  isHealthy(): Promise<boolean>;
}

export interface ChannelConfig {
  type: ChannelType;
  enabled: boolean;
  // Env var names, NOT actual tokens
  accessTokenEnvVar?: string;
  botTokenEnvVar?: string;
  webhookSecretEnvVar?: string;
  // Additional config
  phoneNumberId?: string;  // WhatsApp
  apiVersion?: string;     // WhatsApp
}
```

---

### 3. Channel Router

**File: `src/channels/channel-router.ts`**
```typescript
import type { ChannelAdapter, ChannelType, InboundMessage, OutboundMessage, SendResult } from './types.js';
import type { Logger } from '@/observability/types.js';

export interface ChannelRouter {
  registerAdapter(adapter: ChannelAdapter): void;
  getAdapter(channel: ChannelType): ChannelAdapter | undefined;
  send(message: OutboundMessage): Promise<SendResult>;
  parseInbound(channel: ChannelType, payload: unknown): Promise<InboundMessage | null>;
  listChannels(): ChannelType[];
}

export function createChannelRouter(deps: { logger: Logger }): ChannelRouter {
  const adapters = new Map<ChannelType, ChannelAdapter>();
  
  return {
    registerAdapter(adapter: ChannelAdapter): void {
      adapters.set(adapter.channelType, adapter);
      deps.logger.info(`Registered channel adapter: ${adapter.channelType}`, { component: 'channel-router' });
    },
    
    getAdapter(channel: ChannelType): ChannelAdapter | undefined {
      return adapters.get(channel);
    },
    
    async send(message: OutboundMessage): Promise<SendResult> {
      const adapter = adapters.get(message.channel);
      if (!adapter) {
        return { success: false, error: `No adapter for channel: ${message.channel}` };
      }
      return adapter.send(message);
    },
    
    async parseInbound(channel: ChannelType, payload: unknown): Promise<InboundMessage | null> {
      const adapter = adapters.get(channel);
      if (!adapter) {
        deps.logger.warn(`No adapter for channel: ${channel}`, { component: 'channel-router' });
        return null;
      }
      return adapter.parseInbound(payload);
    },
    
    listChannels(): ChannelType[] {
      return Array.from(adapters.keys());
    }
  };
}
```

---

### 4. Channel Adapters

**File: `src/channels/adapters/telegram.ts`**
```typescript
import type { ChannelAdapter, ChannelConfig, InboundMessage, OutboundMessage, SendResult } from '../types.js';

export interface TelegramAdapterConfig {
  botTokenEnvVar: string;
}

export function createTelegramAdapter(config: TelegramAdapterConfig): ChannelAdapter {
  const getToken = (): string => {
    const token = process.env[config.botTokenEnvVar];
    if (!token) throw new Error(`Missing env var: ${config.botTokenEnvVar}`);
    return token;
  };
  
  const baseUrl = (): string => `https://api.telegram.org/bot${getToken()}`;
  
  return {
    channelType: 'telegram',
    
    async send(message: OutboundMessage): Promise<SendResult> {
      try {
        const response = await fetch(`${baseUrl()}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: message.recipientIdentifier,
            text: message.content,
            parse_mode: message.options?.parseMode === 'html' ? 'HTML' : 'Markdown',
            disable_notification: message.options?.silent ?? false,
            reply_to_message_id: message.replyToChannelMessageId ? Number(message.replyToChannelMessageId) : undefined,
          }),
        });
        
        const data = await response.json() as { ok: boolean; result?: { message_id: number }; description?: string };
        
        if (data.ok && data.result) {
          return { success: true, channelMessageId: String(data.result.message_id) };
        }
        return { success: false, error: data.description ?? 'Unknown error' };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    },
    
    async parseInbound(payload: unknown): Promise<InboundMessage | null> {
      // Parse Telegram Update object
      // See: https://core.telegram.org/bots/api#update
      const update = payload as Record<string, unknown>;
      const message = update['message'] as Record<string, unknown> | undefined;
      
      if (!message) return null;
      
      const chat = message['chat'] as Record<string, unknown>;
      const from = message['from'] as Record<string, unknown>;
      const text = message['text'] as string | undefined;
      
      if (!text) return null;  // Skip non-text messages for now
      
      return {
        id: `tg-${message['message_id']}`,
        channel: 'telegram',
        channelMessageId: String(message['message_id']),
        projectId: '',  // Will be resolved by inbound processor
        senderIdentifier: String(chat['id']),
        senderName: (from['first_name'] as string) ?? undefined,
        content: text,
        rawPayload: payload,
        receivedAt: new Date((message['date'] as number) * 1000),
      };
    },
    
    async isHealthy(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl()}/getMe`);
        const data = await response.json() as { ok: boolean };
        return data.ok;
      } catch {
        return false;
      }
    }
  };
}
```

**File: `src/channels/adapters/whatsapp.ts`**
Similar structure, use WhatsApp Cloud API:
- POST `https://graph.facebook.com/{api_version}/{phone_number_id}/messages`
- Parse webhook payload format

**File: `src/channels/adapters/slack.ts`**
Similar structure, use Slack Web API:
- POST `https://slack.com/api/chat.postMessage`
- Parse Slack Events API payload

**File: `src/channels/adapters/index.ts`** — Barrel file

---

### 5. Inbound Processor

**File: `src/channels/inbound-processor.ts`**
```typescript
import type { InboundMessage, ChannelType, SendResult } from './types.js';
import type { ChannelRouter } from './channel-router.js';
import type { ContactRepository, ChannelIdentifier } from '@/contacts/types.js';
import type { SessionRepository } from '@/infrastructure/repositories/types.js';
import type { Logger } from '@/observability/types.js';
import type { AgentRunner } from '@/core/agent-runner.js';
import type { CostGuard } from '@/cost/cost-guard.js';
import type { ApprovalGate } from '@/security/approval-gate.js';

export interface InboundProcessorDeps {
  channelRouter: ChannelRouter;
  contactRepository: ContactRepository;
  sessionRepository: SessionRepository;
  agentRunner: AgentRunner;
  costGuard: CostGuard;
  approvalGate: ApprovalGate;
  logger: Logger;
  defaultProjectId: string;  // For now, single project
}

export interface InboundProcessor {
  process(message: InboundMessage): Promise<SendResult>;
}

export function createInboundProcessor(deps: InboundProcessorDeps): InboundProcessor {
  return {
    async process(message: InboundMessage): Promise<SendResult> {
      const { logger, contactRepository, sessionRepository, agentRunner, channelRouter } = deps;
      
      logger.info('Processing inbound message', { 
        channel: message.channel, 
        sender: message.senderIdentifier,
        component: 'inbound-processor'
      });
      
      // 1. Resolve or create contact
      const identifier = channelToIdentifier(message.channel, message.senderIdentifier);
      let contact = await contactRepository.findByChannel(deps.defaultProjectId, identifier);
      
      if (!contact) {
        contact = await contactRepository.create({
          projectId: deps.defaultProjectId,
          name: message.senderName ?? message.senderIdentifier,
          [identifier.type]: identifier.value,
        });
        logger.info('Created new contact', { contactId: contact.id, component: 'inbound-processor' });
      }
      
      // 2. Find or create session for this contact
      let session = await sessionRepository.findActiveByContact(contact.id);
      
      if (!session) {
        session = await sessionRepository.create({
          projectId: deps.defaultProjectId,
          contactId: contact.id,
          metadata: { channel: message.channel },
        });
        logger.info('Created new session', { sessionId: session.id, component: 'inbound-processor' });
      }
      
      // 3. Run agent (with cost guard and approval gate)
      // The AgentRunner should already integrate with these
      const result = await agentRunner.run({
        projectId: deps.defaultProjectId,
        sessionId: session.id,
        userMessage: message.content,
      });
      
      // 4. Send response back
      const response = await channelRouter.send({
        channel: message.channel,
        recipientIdentifier: message.senderIdentifier,
        content: result.response,
        replyToChannelMessageId: message.channelMessageId,
      });
      
      return response;
    }
  };
}

function channelToIdentifier(channel: ChannelType, value: string): ChannelIdentifier {
  switch (channel) {
    case 'telegram': return { type: 'telegramId', value };
    case 'whatsapp': return { type: 'phone', value };
    case 'slack': return { type: 'slackId', value };
    case 'email': return { type: 'email', value };
  }
}
```

---

### 6. Proactive Messenger

**File: `src/channels/proactive.ts`**
```typescript
import type { Queue } from 'bullmq';
import type { ChannelRouter } from './channel-router.js';
import type { ChannelType, SendResult } from './types.js';
import type { ContactId } from '@/contacts/types.js';
import type { Logger } from '@/observability/types.js';

export interface ProactiveMessageRequest {
  contactId: ContactId;
  channel: ChannelType;
  recipientIdentifier: string;
  content: string;
  scheduledFor?: Date;
  metadata?: Record<string, unknown>;
}

export interface ProactiveMessenger {
  send(request: ProactiveMessageRequest): Promise<SendResult>;
  schedule(request: ProactiveMessageRequest): Promise<string>;  // Returns job ID
  cancel(jobId: string): Promise<boolean>;
}

export function createProactiveMessenger(deps: {
  channelRouter: ChannelRouter;
  queue: Queue;
  logger: Logger;
}): ProactiveMessenger {
  return {
    async send(request: ProactiveMessageRequest): Promise<SendResult> {
      return deps.channelRouter.send({
        channel: request.channel,
        recipientIdentifier: request.recipientIdentifier,
        content: request.content,
      });
    },
    
    async schedule(request: ProactiveMessageRequest): Promise<string> {
      const delay = request.scheduledFor 
        ? request.scheduledFor.getTime() - Date.now()
        : 0;
      
      const job = await deps.queue.add('proactive-message', request, {
        delay: Math.max(0, delay),
        removeOnComplete: true,
      });
      
      deps.logger.info('Scheduled proactive message', { 
        jobId: job.id, 
        contactId: request.contactId,
        scheduledFor: request.scheduledFor,
        component: 'proactive-messenger'
      });
      
      return job.id!;
    },
    
    async cancel(jobId: string): Promise<boolean> {
      const job = await deps.queue.getJob(jobId);
      if (job) {
        await job.remove();
        return true;
      }
      return false;
    }
  };
}
```

---

### 7. Webhook Routes

**File: `src/api/routes/webhooks.ts`**
```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { z } from 'zod';

export async function webhookRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies
): Promise<void> {
  // Telegram webhook
  fastify.post('/webhooks/telegram', async (request: FastifyRequest, reply: FastifyReply) => {
    const message = await deps.channelRouter.parseInbound('telegram', request.body);
    
    if (message) {
      // Process async, respond immediately
      void deps.inboundProcessor.process(message);
    }
    
    return reply.status(200).send({ ok: true });
  });
  
  // WhatsApp webhook verification (GET)
  fastify.get('/webhooks/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const mode = query['hub.mode'];
    const token = query['hub.verify_token'];
    const challenge = query['hub.challenge'];
    
    const verifyToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];
    
    if (mode === 'subscribe' && token === verifyToken) {
      return reply.status(200).send(challenge);
    }
    return reply.status(403).send('Forbidden');
  });
  
  // WhatsApp webhook (POST)
  fastify.post('/webhooks/whatsapp', async (request: FastifyRequest, reply: FastifyReply) => {
    const message = await deps.channelRouter.parseInbound('whatsapp', request.body);
    
    if (message) {
      void deps.inboundProcessor.process(message);
    }
    
    return reply.status(200).send({ ok: true });
  });
  
  // Slack webhook
  fastify.post('/webhooks/slack', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = request.body as Record<string, unknown>;
    
    // Handle Slack URL verification challenge
    if (body['type'] === 'url_verification') {
      return reply.send({ challenge: body['challenge'] });
    }
    
    const message = await deps.channelRouter.parseInbound('slack', request.body);
    
    if (message) {
      void deps.inboundProcessor.process(message);
    }
    
    return reply.status(200).send({ ok: true });
  });
}
```

---

### 8. Contact API Routes

**File: `src/api/routes/contacts.ts`**
```typescript
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RouteDependencies } from '../types.js';
import { z } from 'zod';

const createContactSchema = z.object({
  projectId: z.string(),
  name: z.string(),
  displayName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  telegramId: z.string().optional(),
  slackId: z.string().optional(),
  timezone: z.string().optional(),
  language: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const updateContactSchema = createContactSchema.partial().omit({ projectId: true });

export async function contactRoutes(
  fastify: FastifyInstance,
  deps: RouteDependencies
): Promise<void> {
  // List contacts
  fastify.get('/projects/:projectId/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    const { projectId } = request.params as { projectId: string };
    const { limit, offset } = request.query as { limit?: string; offset?: string };
    
    const contacts = await deps.contactRepository.list(projectId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    
    return { contacts };
  });
  
  // Get contact
  fastify.get('/contacts/:contactId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { contactId } = request.params as { contactId: string };
    const contact = await deps.contactRepository.findById(contactId);
    
    if (!contact) {
      return reply.status(404).send({ error: 'Contact not found' });
    }
    
    return { contact };
  });
  
  // Create contact
  fastify.post('/contacts', async (request: FastifyRequest, reply: FastifyReply) => {
    const input = createContactSchema.parse(request.body);
    const contact = await deps.contactRepository.create(input);
    return reply.status(201).send({ contact });
  });
  
  // Update contact
  fastify.patch('/contacts/:contactId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { contactId } = request.params as { contactId: string };
    const input = updateContactSchema.parse(request.body);
    const contact = await deps.contactRepository.update(contactId, input);
    return { contact };
  });
  
  // Delete contact
  fastify.delete('/contacts/:contactId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { contactId } = request.params as { contactId: string };
    await deps.contactRepository.delete(contactId);
    return reply.status(204).send();
  });
}
```

---

### 9. Barrel Files

**File: `src/channels/index.ts`**
```typescript
export * from './types.js';
export { createChannelRouter } from './channel-router.js';
export { createInboundProcessor } from './inbound-processor.js';
export { createProactiveMessenger } from './proactive.js';
export { createTelegramAdapter } from './adapters/telegram.js';
export { createWhatsAppAdapter } from './adapters/whatsapp.js';
export { createSlackAdapter } from './adapters/slack.js';
```

**File: `src/contacts/index.ts`**
```typescript
export * from './types.js';
```

---

### 10. Update RouteDependencies

**File: `src/api/types.ts`** — Add new deps:
```typescript
import type { ChannelRouter } from '@/channels/channel-router.js';
import type { InboundProcessor } from '@/channels/inbound-processor.js';
import type { ContactRepository } from '@/contacts/types.js';

export interface RouteDependencies {
  // ... existing
  channelRouter: ChannelRouter;
  inboundProcessor: InboundProcessor;
  contactRepository: ContactRepository;
}
```

---

### 11. Update main.ts

Wire up channels and contacts in `src/main.ts`.

---

## Tests Required

Every file needs a `.test.ts`:
- `src/contacts/types.test.ts` (if any runtime validation)
- `src/infrastructure/repositories/contact-repository.test.ts`
- `src/channels/channel-router.test.ts`
- `src/channels/adapters/telegram.test.ts`
- `src/channels/adapters/whatsapp.test.ts`
- `src/channels/adapters/slack.test.ts`
- `src/channels/inbound-processor.test.ts`
- `src/channels/proactive.test.ts`
- `src/api/routes/webhooks.test.ts`
- `src/api/routes/contacts.test.ts`

Use `vitest` + `vi.mock()` for mocking.

---

## Critical Rules

1. **Secrets via env var names** — Config has `botTokenEnvVar: 'TELEGRAM_BOT_TOKEN'`, adapter reads `process.env[config.botTokenEnvVar]`
2. **Factory functions, not classes**
3. **`import type` for type-only imports**
4. **`.js` extension in all imports**
5. **Zod validation on all API inputs**
6. **Named exports only**
7. **InboundProcessor must respect CostGuard and ApprovalGate**
8. **Follow existing patterns** — look at other repositories, routes, etc.

---

## Commit Strategy

Make small, logical commits:
1. `feat(contacts): add Contact model and migration`
2. `feat(contacts): add contact repository`
3. `feat(channels): add channel types and router`
4. `feat(channels): add telegram adapter`
5. `feat(channels): add whatsapp adapter`
6. `feat(channels): add slack adapter`
7. `feat(channels): add inbound processor`
8. `feat(channels): add proactive messenger`
9. `feat(api): add webhook routes`
10. `feat(api): add contact routes`
11. `test: add tests for channels and contacts`

---

## When Done

```bash
git push origin feature/channels-contacts
```

Then notify:
```bash
openclaw gateway wake --text "Done: feature/channels-contacts complete - Channels + Contacts + Proactive Messaging implemented" --mode now
```
