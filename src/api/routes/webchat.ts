/**
 * Webchat routes — embeddable chat widget for external websites.
 *
 * Two sets of routes:
 *   Public  (no auth, registered on root server):
 *     GET  /webchat/widget.js          — serve embeddable JS widget
 *     GET  /webchat/:projectId/config  — public display config
 *     POST /webchat/:projectId/session — create or resume visitor session
 *     POST /webchat/:projectId/message — send message → agent response
 *
 *   Admin (Bearer-auth, registered under /api/v1):
 *     GET /api/v1/projects/:projectId/webchat  — get webchat config
 *     PUT /api/v1/projects/:projectId/webchat  — create/update webchat config
 */
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PrismaClient, ChannelIntegration } from '@prisma/client';
import type { SessionRepository } from '@/infrastructure/repositories/session-repository.js';
import type { ProjectId, SessionId } from '@/core/types.js';
import type { Logger } from '@/observability/logger.js';

// ─── Types ───────────────────────────────────────────────────────

/** Dependencies for the public widget routes (no auth). */
export interface WebchatPublicDeps {
  prisma: PrismaClient;
  sessionRepository: SessionRepository;
  logger: Logger;
  runAgent: (params: {
    projectId: ProjectId;
    sessionId: string;
    agentId?: string;
    sourceChannel?: string;
    userMessage: string;
  }) => Promise<{ response: string }>;
}

/** Dependencies for the admin config routes (Bearer auth). */
export interface WebchatAdminDeps {
  prisma: PrismaClient;
  logger: Logger;
}

/** Webchat configuration stored in ChannelIntegration.config JSON. */
export interface WebchatConfig {
  title: string;
  welcomeMessage: string;
  primaryColor: string;
  agentName: string;
  agentId?: string;
  allowedDomains?: string[];
}

// ─── Constants ───────────────────────────────────────────────────

const WEBCHAT_PROVIDER = 'webchat';

// ─── Zod Schemas ─────────────────────────────────────────────────

const WebchatConfigSchema = z.object({
  title: z.string().min(1).max(100).default('Chat'),
  welcomeMessage: z.string().min(1).max(500).default('¡Hola! ¿En qué puedo ayudarte?'),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
  agentName: z.string().min(1).max(100).default('Asistente'),
  agentId: z.string().optional(),
  allowedDomains: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

const SendMessageSchema = z.object({
  sessionToken: z.string().uuid(),
  message: z.string().min(1).max(4000),
});

// ─── Helpers ─────────────────────────────────────────────────────

async function getWebchatIntegration(prisma: PrismaClient, projectId: string): Promise<ChannelIntegration | null> {
  return prisma.channelIntegration.findFirst({
    where: { projectId, provider: WEBCHAT_PROVIDER },
  });
}

// ─── Widget JS ───────────────────────────────────────────────────

/**
 * Generates the self-contained embeddable JavaScript widget.
 * Inlined as a string so fomo-core serves it directly — no CDN needed.
 */
function generateWidgetJs(): string {
  return `(function(){
'use strict';
var script=document.currentScript||(function(){var s=document.querySelectorAll('script[data-project]');return s[s.length-1];})();
if(!script)return;
var projectId=script.getAttribute('data-project');
if(!projectId){console.error('[Fomo] data-project required');return;}
var baseUrl=script.src.replace(/\\/webchat\\/widget\\.js.*/,'');
var storageKey='fomo_wc_'+projectId;
var sessionToken=null;
try{sessionToken=localStorage.getItem(storageKey);}catch(e){}

var cfg={title:'Chat',welcomeMessage:'¡Hola! ¿En qué puedo ayudarte?',primaryColor:'#6366f1',agentName:'Asistente'};
var isOpen=false;
var isTyping=false;

// ── Styles ──────────────────────────────────────────────────
var style=document.createElement('style');
style.textContent=[
  '#fomo-wc *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:0;}',
  '#fomo-wc-btn{position:fixed;bottom:24px;right:24px;width:56px;height:56px;border-radius:50%;background:var(--fomo-color,#6366f1);color:#fff;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;z-index:2147483646;transition:transform .2s;}',
  '#fomo-wc-btn:hover{transform:scale(1.08);}',
  '#fomo-wc-panel{position:fixed;bottom:92px;right:24px;width:360px;max-height:520px;border-radius:16px;background:#fff;box-shadow:0 8px 32px rgba(0,0,0,.15);display:flex;flex-direction:column;z-index:2147483645;overflow:hidden;transform:scale(.92) translateY(8px);opacity:0;pointer-events:none;transition:transform .2s,opacity .2s;}',
  '#fomo-wc-panel.open{transform:scale(1) translateY(0);opacity:1;pointer-events:auto;}',
  '#fomo-wc-header{background:var(--fomo-color,#6366f1);color:#fff;padding:16px;display:flex;align-items:center;gap:10px;}',
  '#fomo-wc-header .avatar{width:36px;height:36px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;flex-shrink:0;}',
  '#fomo-wc-header .info .name{font-weight:600;font-size:14px;}',
  '#fomo-wc-header .info .status{font-size:12px;opacity:.8;}',
  '#fomo-wc-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px;min-height:200px;}',
  '.fomo-msg{max-width:80%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.45;word-break:break-word;}',
  '.fomo-msg.user{background:var(--fomo-color,#6366f1);color:#fff;align-self:flex-end;border-bottom-right-radius:4px;}',
  '.fomo-msg.bot{background:#f1f5f9;color:#1e293b;align-self:flex-start;border-bottom-left-radius:4px;}',
  '.fomo-typing{display:flex;gap:4px;align-items:center;padding:12px 14px;}',
  '.fomo-typing span{width:7px;height:7px;border-radius:50%;background:#94a3b8;animation:fomo-bounce .9s infinite;}',
  '.fomo-typing span:nth-child(2){animation-delay:.15s;}',
  '.fomo-typing span:nth-child(3){animation-delay:.3s;}',
  '@keyframes fomo-bounce{0%,60%,100%{transform:translateY(0);}30%{transform:translateY(-5px);}}',
  '#fomo-wc-footer{border-top:1px solid #e2e8f0;padding:12px;display:flex;gap:8px;}',
  '#fomo-wc-input{flex:1;border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:14px;outline:none;resize:none;height:38px;line-height:1.4;}',
  '#fomo-wc-input:focus{border-color:var(--fomo-color,#6366f1);}',
  '#fomo-wc-send{background:var(--fomo-color,#6366f1);color:#fff;border:none;border-radius:8px;width:38px;height:38px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;}',
  '#fomo-wc-send:disabled{opacity:.5;cursor:not-allowed;}',
  '@media(max-width:420px){#fomo-wc-panel{right:12px;left:12px;width:auto;bottom:80px;}}',
].join('');
document.head.appendChild(style);

// ── DOM ──────────────────────────────────────────────────────
var root=document.createElement('div');
root.id='fomo-wc';
root.innerHTML=[
  '<button id="fomo-wc-btn" aria-label="Abrir chat">',
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  '</button>',
  '<div id="fomo-wc-panel" role="dialog" aria-label="Chat">',
    '<div id="fomo-wc-header">',
      '<div class="avatar" id="fomo-wc-avatar">A</div>',
      '<div class="info">',
        '<div class="name" id="fomo-wc-name">Asistente</div>',
        '<div class="status">En línea</div>',
      '</div>',
    '</div>',
    '<div id="fomo-wc-msgs"></div>',
    '<div id="fomo-wc-footer">',
      '<textarea id="fomo-wc-input" placeholder="Escribe un mensaje..." rows="1"></textarea>',
      '<button id="fomo-wc-send" aria-label="Enviar">',
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
      '</button>',
    '</div>',
  '</div>',
].join('');
document.body.appendChild(root);

var btn=document.getElementById('fomo-wc-btn');
var panel=document.getElementById('fomo-wc-panel');
var msgs=document.getElementById('fomo-wc-msgs');
var input=document.getElementById('fomo-wc-input');
var sendBtn=document.getElementById('fomo-wc-send');
var avatar=document.getElementById('fomo-wc-avatar');
var nameEl=document.getElementById('fomo-wc-name');

// ── Utils ────────────────────────────────────────────────────
function setColor(color){
  root.style.setProperty('--fomo-color',color);
}

function appendMsg(role,text){
  var div=document.createElement('div');
  div.className='fomo-msg '+role;
  div.textContent=text;
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
  return div;
}

function showTyping(){
  var div=document.createElement('div');
  div.className='fomo-msg bot fomo-typing';
  div.id='fomo-typing-indicator';
  div.innerHTML='<span></span><span></span><span></span>';
  msgs.appendChild(div);
  msgs.scrollTop=msgs.scrollHeight;
}

function hideTyping(){
  var el=document.getElementById('fomo-typing-indicator');
  if(el)el.remove();
}

function setSending(v){
  isTyping=v;
  sendBtn.disabled=v;
  input.disabled=v;
}

// ── Session ──────────────────────────────────────────────────
function ensureSession(){
  return fetch(baseUrl+'/webchat/'+projectId+'/session',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({sessionToken:sessionToken}),
  })
  .then(function(r){return r.json();})
  .then(function(d){
    sessionToken=d.sessionToken;
    try{localStorage.setItem(storageKey,sessionToken);}catch(e){}
    return sessionToken;
  });
}

// ── Send ─────────────────────────────────────────────────────
function send(){
  var text=(input.value||'').trim();
  if(!text||isTyping)return;
  input.value='';
  appendMsg('user',text);
  setSending(true);
  showTyping();
  ensureSession().then(function(token){
    return fetch(baseUrl+'/webchat/'+projectId+'/message',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({sessionToken:token,message:text}),
    });
  })
  .then(function(r){return r.json();})
  .then(function(d){
    hideTyping();
    if(d.response){appendMsg('bot',d.response);}
    else if(d.paused){appendMsg('bot','Tu mensaje fue recibido. Un agente te responderá en breve.');}
  })
  .catch(function(){
    hideTyping();
    appendMsg('bot','Hubo un error. Por favor intenta de nuevo.');
  })
  .finally(function(){setSending(false);});
}

// ── Toggle ───────────────────────────────────────────────────
btn.addEventListener('click',function(){
  isOpen=!isOpen;
  panel.classList.toggle('open',isOpen);
  if(isOpen&&msgs.children.length===0){
    appendMsg('bot',cfg.welcomeMessage);
  }
  btn.innerHTML=isOpen
    ?'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
    :'<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
});

sendBtn.addEventListener('click',send);
input.addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
});

// ── Config ───────────────────────────────────────────────────
fetch(baseUrl+'/webchat/'+projectId+'/config')
  .then(function(r){return r.ok?r.json():null;})
  .then(function(data){
    if(!data)return;
    cfg=Object.assign(cfg,data);
    setColor(cfg.primaryColor);
    nameEl.textContent=cfg.agentName;
    avatar.textContent=(cfg.agentName||'A').charAt(0).toUpperCase();
    btn.setAttribute('aria-label','Abrir chat con '+cfg.agentName);
  })
  .catch(function(){});
})();`;
}

// ─── Public Routes (no auth) ──────────────────────────────────────

/**
 * Register the public webchat routes directly on the root Fastify instance.
 * These are called from external websites — no API key required.
 */
export function webchatPublicRoutes(
  server: FastifyInstance,
  deps: WebchatPublicDeps,
): void {
  const { prisma, sessionRepository, logger, runAgent } = deps;

  /** Serve the embeddable widget JS. */
  server.get('/webchat/widget.js', async (_request, reply) => {
    const js = generateWidgetJs();
    return reply
      .header('Content-Type', 'application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=3600')
      .send(js);
  });

  /** Return public display config (title, color, welcome message). */
  server.get<{ Params: { projectId: string } }>(
    '/webchat/:projectId/config',
    async (request, reply) => {
      const { projectId } = request.params;
      const integration = await getWebchatIntegration(prisma, projectId);

      if (integration?.status !== 'active') {
        return reply.code(404).send({ error: 'Webchat not configured or disabled' });
      }

      const cfg = integration.config as Partial<WebchatConfig>;
      return reply.send({
        title: cfg.title ?? 'Chat',
        welcomeMessage: cfg.welcomeMessage ?? '¡Hola! ¿En qué puedo ayudarte?',
        primaryColor: cfg.primaryColor ?? '#6366f1',
        agentName: cfg.agentName ?? 'Asistente',
      });
    },
  );

  /** Create a new visitor session, or resume an existing one by token. */
  server.post<{ Params: { projectId: string } }>(
    '/webchat/:projectId/session',
    async (request, reply) => {
      const { projectId } = request.params;
      const body = request.body as { sessionToken?: unknown };

      const integration = await getWebchatIntegration(prisma, projectId);
      if (integration?.status !== 'active') {
        return reply.code(403).send({ error: 'Webchat not enabled for this project' });
      }

      const cfg = integration.config as Partial<WebchatConfig>;
      const agentId = cfg.agentId;

      // Resume existing session if token provided and still active
      if (typeof body.sessionToken === 'string' && body.sessionToken.length > 0) {
        const existing = await prisma.session.findFirst({
          where: {
            projectId,
            status: 'active',
            metadata: { path: ['webchatToken'], equals: body.sessionToken },
          },
        });
        if (existing) {
          return reply.send({ sessionToken: body.sessionToken, sessionId: existing.id });
        }
      }

      // Create new session
      const newToken = randomUUID();
      const session = await sessionRepository.create({
        projectId: projectId as ProjectId,
        metadata: {
          webchatToken: newToken,
          channel: 'webchat',
          ...(agentId ? { agentId } : {}),
        },
      });

      logger.info('Webchat session created', {
        component: 'webchat',
        projectId,
        sessionId: session.id,
      });

      return reply.send({ sessionToken: newToken, sessionId: session.id });
    },
  );

  /** Receive a visitor message, run the agent, return the response. */
  server.post<{ Params: { projectId: string } }>(
    '/webchat/:projectId/message',
    async (request, reply) => {
      const { projectId } = request.params;
      const parseResult = SendMessageSchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.code(400).send({ error: 'Invalid request' });
      }

      const { sessionToken, message } = parseResult.data;

      const sessionRecord = await prisma.session.findFirst({
        where: {
          projectId,
          metadata: { path: ['webchatToken'], equals: sessionToken },
        },
      });

      if (!sessionRecord) {
        return reply.code(404).send({ error: 'Session not found or expired' });
      }

      // Paused session (operator takeover) — persist but skip agent
      if (sessionRecord.status === 'paused') {
        await sessionRepository.addMessage(
          sessionRecord.id as SessionId,
          { role: 'user', content: message },
        );
        return reply.send({ response: null, paused: true });
      }

      const integration = await getWebchatIntegration(prisma, projectId);
      const cfg = (integration?.config ?? {}) as Partial<WebchatConfig>;

      try {
        const result = await runAgent({
          projectId: projectId as ProjectId,
          sessionId: sessionRecord.id,
          agentId: cfg.agentId,
          sourceChannel: 'webchat',
          userMessage: message,
        });
        return await reply.send({ response: result.response });
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        logger.error('Webchat agent error', { component: 'webchat', projectId, error: msg });
        return reply.code(500).send({ error: 'Failed to process message' });
      }
    },
  );
}

// ─── Admin Routes (Bearer auth, under /api/v1) ────────────────────

/**
 * Register the admin webchat config routes under the /api/v1 authenticated scope.
 */
export function webchatAdminRoutes(
  fastify: FastifyInstance,
  deps: WebchatAdminDeps,
): void {
  const { prisma, logger } = deps;

  /** Get webchat config for a project. */
  fastify.get<{ Params: { projectId: string } }>(
    '/projects/:projectId/webchat',
    async (request, reply) => {
      const { projectId } = request.params;
      const integration = await getWebchatIntegration(prisma, projectId);

      if (!integration) {
        // Return disabled default config — no 404, just "not yet configured"
        return reply.send({
          enabled: false,
          title: 'Chat',
          welcomeMessage: '¡Hola! ¿En qué puedo ayudarte?',
          primaryColor: '#6366f1',
          agentName: 'Asistente',
          agentId: null,
          allowedDomains: [],
        });
      }

      const cfg = integration.config as Partial<WebchatConfig>;
      return reply.send({
        enabled: integration.status === 'active',
        title: cfg.title ?? 'Chat',
        welcomeMessage: cfg.welcomeMessage ?? '¡Hola! ¿En qué puedo ayudarte?',
        primaryColor: cfg.primaryColor ?? '#6366f1',
        agentName: cfg.agentName ?? 'Asistente',
        agentId: cfg.agentId ?? null,
        allowedDomains: cfg.allowedDomains ?? [],
      });
    },
  );

  /** Create or update webchat config for a project. */
  fastify.put<{ Params: { projectId: string } }>(
    '/projects/:projectId/webchat',
    async (request, reply) => {
      const { projectId } = request.params;

      const bodySchema = WebchatConfigSchema.extend({ enabled: z.boolean().default(true) });
      const parseResult = bodySchema.safeParse(request.body);

      if (!parseResult.success) {
        return reply.code(400).send({ error: 'Invalid config', details: parseResult.error.flatten() });
      }

      const { enabled, ...configFields } = parseResult.data;
      const status = enabled ? 'active' : 'paused';

      const existing = await getWebchatIntegration(prisma, projectId);

      if (existing) {
        await prisma.channelIntegration.update({
          where: { id: existing.id },
          data: {
            config: configFields,
            status,
            updatedAt: new Date(),
          },
        });
      } else {
        await prisma.channelIntegration.create({
          data: {
            projectId,
            provider: WEBCHAT_PROVIDER,
            config: configFields,
            status,
          },
        });
      }

      logger.info('Webchat config updated', { component: 'webchat', projectId, enabled });
      return reply.send({ ok: true, enabled });
    },
  );
}
