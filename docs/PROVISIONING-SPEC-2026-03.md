# Especificación Técnica: Sistema de Provisioning OpenClaw para FOMO

**Versión:** 1.0  
**Fecha:** 2026-03-16  
**Autor:** Arquitectura FOMO  
**Estado:** Draft → Accionable

---

## 1. Arquitectura del Sistema de Provisioning

### 1.1 Overview General

**Decisiones de arquitectura:**
- Routing: WhatsApp/Telegram → fomo-core primero → (cuando necesita) → OpenClaw Manager del cliente
- Provisioning: Docker containers en VPS compartido (Hostinger, IP 147.79.81.222) — un container por cliente
- Channels de clientes: WhatsApp, Telegram, Slack, Teams (desde fomo-platform)
- Clientes iniciales: 10

### 1.2 Decisión: Docker Socket API vs Portainer vs SSH

**Opción elegida: Docker Socket API directa**

| Criterio | Docker Socket API | Portainer API | SSH Directa |
|----------|-------------------|---------------|-------------|
| **Complejidad** | Media | Alta | Media-Alta |
| **Overhead** | Bajo | Medio (requiere Portainer) | Bajo |
| **Control granular** | ✅ Total | ⚠️ Limitado por abstracción | ✅ Total |
| **Latencia** | ✅ Local (socket) | Red + overhead | Red + crypto |
| **Seguridad** | ⚠️ Requiere hardening | ✅ Buena | ⚠️ Key management |
| **Observabilidad** | ✅ Directa | ⚠️ Via Portainer | ✅ Directa |
| **Rollback** | ✅ Fácil | ⚠️ Mediante snapshots | ✅ Fácil |

**Justificación:**
- El provisioning service corre en el mismo VPS que los contenedores
- Acceso directo al Docker socket (/var/run/docker.sock) da control total sin intermediarios
- Menos puntos de falla (sin Portainer como dependencia)
- Permite integración directa con health checks y logs

**Hardening del socket:**
```yaml
# docker-compose.provisioning.yml
services:
  provisioning:
    image: fomo/provisioning-service:latest
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro  # read-only
    environment:
      - DOCKER_SOCKET_PATH=/var/run/docker.sock
      - DOCKER_API_VERSION=1.43
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    cap_add:
      - DAC_READ_SEARCH
```

### 1.3 Schema DB PostgreSQL (fomo-core)

```sql
-- Tabla principal de instancias OpenClaw
CREATE TABLE openclaw_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    
    -- Identificación
    instance_name VARCHAR(64) NOT NULL UNIQUE,           -- ej: "acme-corp"
    subdomain VARCHAR(64) NOT NULL UNIQUE,               -- ej: "acme"
    display_name VARCHAR(128) NOT NULL,                  -- ej: "ACME Corporation"
    
    -- Template y configuración
    template_type VARCHAR(32) NOT NULL,                  -- 'ventas' | 'atencion' | 'operaciones' | 'custom'
    vertical VARCHAR(32),                                -- rubro específico
    config JSONB NOT NULL DEFAULT '{}',                  -- configuración completa
    
    -- Networking
    internal_port INTEGER NOT NULL,                      -- puerto host (3001, 3002...)
    public_url VARCHAR(256) NOT NULL,                    -- https://acme.fomo.com.ar
    
    -- Estado
    status VARCHAR(32) NOT NULL DEFAULT 'provisioning',  -- 'provisioning' | 'running' | 'stopped' | 'error' | 'deprovisioning'
    health_status VARCHAR(32) DEFAULT 'unknown',         -- 'healthy' | 'unhealthy' | 'unknown'
    last_health_check TIMESTAMPTZ,
    
    -- Docker
    container_id VARCHAR(64),                            -- ID del contenedor Docker
    container_name VARCHAR(128),                         -- nombre del contenedor
    image_tag VARCHAR(64) DEFAULT 'latest',              -- tag de la imagen usada
    
    -- Recursos
    memory_limit VARCHAR(16) DEFAULT '512m',             -- límite de memoria
    cpu_limit VARCHAR(16) DEFAULT '1.0',                 -- límite de CPU
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    provisioned_at TIMESTAMPTZ,
    deprovisioned_at TIMESTAMPTZ,
    
    -- Metadatos
    created_by UUID REFERENCES users(id),
    notes TEXT
);

-- Índices
CREATE INDEX idx_openclaw_instances_client_id ON openclaw_instances(client_id);
CREATE INDEX idx_openclaw_instances_status ON openclaw_instances(status);
CREATE INDEX idx_openclaw_instances_subdomain ON openclaw_instances(subdomain);

-- Tabla de canales activos por instancia
CREATE TABLE openclaw_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES openclaw_instances(id) ON DELETE CASCADE,
    
    channel_type VARCHAR(32) NOT NULL,     -- 'whatsapp' | 'telegram' | 'slack' | 'teams' | 'email'
    channel_name VARCHAR(64) NOT NULL,     -- nombre legible
    
    -- Configuración específica por canal (encriptada)
    config_encrypted TEXT NOT NULL,        -- JSON encriptado con credenciales
    
    -- Estado del canal
    is_active BOOLEAN DEFAULT false,
    is_connected BOOLEAN DEFAULT false,
    last_connected_at TIMESTAMPTZ,
    
    -- Webhooks (para canales que lo requieren)
    webhook_url VARCHAR(512),
    webhook_secret VARCHAR(256),
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    activated_at TIMESTAMPTZ,
    
    UNIQUE(instance_id, channel_type, channel_name)
);

-- Tabla de secrets (valores sensibles encriptados)
CREATE TABLE openclaw_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES openclaw_instances(id) ON DELETE CASCADE,
    
    secret_key VARCHAR(64) NOT NULL,       -- nombre del secret
    secret_value_encrypted TEXT NOT NULL,  -- valor encriptado
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(instance_id, secret_key)
);

-- Tabla de eventos de lifecycle
CREATE TABLE openclaw_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL REFERENCES openclaw_instances(id) ON DELETE CASCADE,
    
    event_type VARCHAR(64) NOT NULL,       -- 'provision_start' | 'provision_complete' | 'restart' | 'config_update' | 'error'
    event_data JSONB DEFAULT '{}',
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);

CREATE INDEX idx_openclaw_events_instance_id ON openclaw_events(instance_id);
CREATE INDEX idx_openclaw_events_created_at ON openclaw_events(created_at);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_openclaw_instances_updated_at 
    BEFORE UPDATE ON openclaw_instances 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 1.4 Variables de Entorno y Secrets por Contenedor

Cada instancia OpenClaw recibe las siguientes variables:

```yaml
# === CORE ===
OPENCLAW_INSTANCE_ID=<uuid>
OPENCLAW_INSTANCE_NAME=<nombre>
OPENCLAW_PUBLIC_URL=https://<subdomain>.fomo.com.ar

# === IDENTIDAD ===
SOUL_COMPANY_NAME=<nombre empresa>
SOUL_COMPANY_VERTICAL=<rubro>
SOUL_TIMEZONE=America/Argentina/Buenos_Aires
SOUL_LOCALE=es-AR

# === DATABASE (SQLite interna del contenedor) ===
DATABASE_URL=file:/data/openclaw.db

# === CHANNELS ===
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER=<número>
WHATSAPP_API_KEY=<encriptado>

TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN=<encriptado>
TELEGRAM_WEBHOOK_SECRET=<random>

SLACK_ENABLED=false
SLACK_BOT_TOKEN=<encriptado>
SLACK_SIGNING_SECRET=<encriptado>

EMAIL_ENABLED=true
EMAIL_PROVIDER=resend
EMAIL_API_KEY=<encriptado>
EMAIL_FROM=<cliente>@fomo.com.ar

# === LLM PROVIDERS ===
OPENAI_API_KEY=<encriptado>
ANTHROPIC_API_KEY=<encriptado>
GROQ_API_KEY=<encriptado>

# === INTEGRACIONES FOMO-CORE ===
FOMO_CORE_API_URL=https://core.fomo.com.ar
FOMO_CORE_API_KEY=<encriptado>
FOMO_CLIENT_ID=<uuid>

# === SEGURIDAD ===
JWT_SECRET=<random-256-bit>
ENCRYPTION_KEY=<aes-256-key>

# === MONITOREO ===
HEALTH_CHECK_PORT=8080
METRICS_ENABLED=true
LOG_LEVEL=info
```

---

## 2. Template de OpenClaw Pre-configurado

### 2.1 Estructura de Archivos del Template

```
templates/
├── base/                              # Template base común a todos
│   ├── SOUL.md                        # Personalidad base del Manager
│   ├── AGENTS.md                      # Configuración de agentes base
│   ├── TOOLS.md                       # Tools disponibles por defecto
│   ├── USER.md.template               # Template para datos del cliente
│   ├── docker/
│   │   ├── Dockerfile
│   │   ├── entrypoint.sh
│   │   └── healthcheck.js
│   └── config/
│       ├── openclaw.config.yml
│       ├── nginx.conf.template
│       └── supervisord.conf
│
├── ventas/                            # Template para vertical de ventas
│   ├── SOUL.md                        # Override de personalidad
│   ├── AGENTS.md                      # Agentes específicos
│   ├── skills/
│   │   ├── crm-integration/
│   │   ├── lead-qualification/
│   │   └── follow-up-reminders/
│   └── prompts/
│       ├── discovery-call.md
│       ├── proposal-followup.md
│       └── objection-handling.md
│
├── atencion/                          # Template para atención al cliente
│   ├── SOUL.md
│   ├── AGENTS.md
│   ├── skills/
│   │   ├── ticket-management/
│   │   ├── knowledge-base/
│   │   └── escalation/
│   └── prompts/
│       ├── greeting.md
│       ├── troubleshooting.md
│       └── handoff-human.md
│
└── operaciones/                       # Template para operaciones
    ├── SOUL.md
    ├── AGENTS.md
    ├── skills/
    │   ├── task-automation/
    │   ├── reporting/
    │   └── scheduling/
    └── prompts/
        ├── daily-standup.md
        ├── status-update.md
        └── alert-handling.md
```

### 2.2 SOUL.md Template (Base)

```markdown
# SOUL.md - Manager Agent de {{company_name}}

## Identidad

**Nombre:** {{manager_name}}  
**Empresa:** {{company_name}}  
**Rol:** Chief of Staff AI - {{company_vertical}}  
**Vibe:** {{personality_vibe}}

## Misión

Soy el Manager Agent de {{company_name}}, diseñado para ayudar a {{owner_name}} 
a gestionar su negocio de {{company_vertical}} de forma más eficiente.

## Capacidades

- 📊 **Análisis de datos:** Reportes, métricas, insights
- 📅 **Gestión de agenda:** Recordatorios, scheduling, follow-ups
- 💬 **Comunicaciones:** Respuestas inteligentes a clientes/proveedores
- 🎯 **Ventas:** Qualificación de leads, seguimientos, propuestas
- ⚡ **Automatizaciones:** Tareas repetitivas, workflows

## Límites

- No tomo decisiones que comprometan financieramente a {{company_name}}
- Escalo a {{owner_name}} situaciones que requieren juicio humano
- Mantengo confidencialidad total sobre datos del negocio
```

### 2.3 Parametrización del Template

```typescript
// types/template.ts
interface TemplateParams {
  // Datos básicos
  companyName: string;
  companyVertical: string;
  ownerName: string;
  ownerEmail: string;
  
  // Personalización
  managerName: string;           // ej: "Alex" (default: "Manager")
  personalityVibe: 'formal' | 'casual' | 'energetic' | 'professional';
  languageTone: 'usted' | 'vos' | 'tu';  // formalidad según región
  
  // Canales activos
  channels: {
    whatsapp?: { phoneNumber: string };
    telegram?: { botToken: string };
    slack?: { workspaceId: string };
    email?: { domain: string };
  };
  
  // Integraciones
  integrations: {
    crm?: 'twenty' | 'hubspot' | 'none';
    calendar?: 'google' | 'outlook' | 'none';
    billing?: 'stripe' | 'mercadopago' | 'afip' | 'none';
  };
  
  // Configuración de agentes
  agentConfig: {
    defaultModel: 'gpt-4' | 'claude-sonnet' | 'groq-llama';
    responseStyle: 'concise' | 'detailed' | 'balanced';
    proactivity: 'low' | 'medium' | 'high';  // qué tan pushie es
  };
}
```

### 2.4 Proceso de Activación de Canales

**WhatsApp:**
1. Guillermina ingresa número de teléfono y display name
2. fomo-core crea Business Account en Meta API
3. Meta envía código de verificación vía SMS/voz
4. Guillermina ingresa código en dashboard
5. Meta verifica y proporciona Phone Number ID + WABA ID
6. provisioning-service configura webhook
7. Instancia OpenClaw recibe credenciales encriptadas

**Telegram:**
1. Guillermina crea bot con @BotFather
2. Ingresa BOT_TOKEN en dashboard
3. provisioning-service genera webhook secret y URL
4. Configura webhook en Telegram API
5. Instancia OpenClaw recibe credenciales

---

## 3. API de Provisioning (fomo-core ↔ Microservicio)

### 3.1 Endpoints

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | /health | Health check del servicio |
| POST | /instances | Provisionar nueva instancia |
| GET | /instances | Listar todas las instancias |
| GET | /instances/{id} | Obtener detalle de instancia |
| DELETE | /instances/{id} | Deprovisionar instancia |
| POST | /instances/{id}/restart | Reiniciar instancia |
| GET | /instances/{id}/status | Estado en tiempo real |
| PATCH | /instances/{id}/config | Actualizar configuración |
| GET | /instances/{id}/logs | Obtener logs |

### 3.2 Autenticación entre Servicios

```yaml
Headers:
  X-API-Key: prov_xxxxxxxxxxxxxxxx
  X-Request-ID: <uuid>
  X-Signature: hmac-sha256(body, secret)
  X-Timestamp: <unix-epoch>
```

### 3.3 Ejemplo de Request/Response

**Provision Request:**
```json
{
  "clientId": "550e8400-e29b-41d4-a716-446655440000",
  "instanceName": "acme-corp",
  "subdomain": "acme",
  "displayName": "ACME Corporation",
  "templateType": "ventas",
  "vertical": "manufactura",
  "owner": {
    "name": "Juan Pérez",
    "email": "juan@acme.com"
  },
  "channels": [
    { "type": "whatsapp", "config": { "phoneNumber": "+5491112345678" } },
    { "type": "telegram", "config": { "botToken": "123456:ABC..." } }
  ],
  "resources": {
    "memory": "512m",
    "cpu": "1.0"
  }
}
```

**Provision Response:**
```json
{
  "instanceId": "660e8400-e29b-41d4-a716-446655440001",
  "instanceName": "acme-corp",
  "subdomain": "acme",
  "publicUrl": "https://acme.fomo.com.ar",
  "status": "provisioning",
  "containerId": "abc123...",
  "internalPort": 3001,
  "credentials": {
    "adminToken": "eyJhbG...",
    "webhookSecret": "whsec_..."
  },
  "createdAt": "2026-03-16T10:00:00Z"
}
```

---

## 4. Dashboard UI (fomo-platform)

### 4.1 Flujo de Creación de Cliente Manager

```
┌─────────────────────────────────────────────────────────────────┐
│  PASO 1: SELECCIONAR TEMPLATE                                   │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐               │
│  │   VENTAS    │ │  ATENCIÓN   │ │ OPERACIONES │               │
│  │    📈       │ │    🎧       │ │    ⚙️       │               │
│  │  Qualificar │ │   Tickets   │ │  Tareas     │               │
│  │  leads      │ │   Soporte   │ │  Reportes   │               │
│  └─────────────┘ └─────────────┘ └─────────────┘               │
├─────────────────────────────────────────────────────────────────┤
│  PASO 2: CONFIGURAR DATOS DEL CLIENTE                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Nombre empresa: [ ACME Corporation              ]      │   │
│  │  Subdominio:     [ acme          ] .fomo.com.ar         │   │
│  │  Rubro:          [ Manufactura ▼ ]                      │   │
│  │  Nombre owner:   [ Juan Pérez                    ]      │   │
│  │  Email:          [ juan@acme.com                 ]      │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  PASO 3: ELEGIR CANALES                                        │
│  ☑️ WhatsApp    [ +54 9 11 1234-5678 ]                        │
│  ☑️ Telegram    [ @acme_bot          ]                        │
│  ☐ Slack       [ Configurar después  ]                        │
│  ☑️ Email       [ acme@fomo.com.ar   ]                        │
├─────────────────────────────────────────────────────────────────┤
│  PASO 4: LANZAR PROVISIONING                                   │
│  [ 🚀 CREAR MANAGER AGENT ]                                    │
│  ⏳ Provisioning en progreso...                                │
├─────────────────────────────────────────────────────────────────┤
│  PASO 5: VER ESTADO Y URL                                      │
│  ✅ Instancia creada exitosamente                              │
│  🔗 URL: https://acme.fomo.com.ar                              │
│  📱 WhatsApp: +54 9 11 1234-5678                              │
│  🤖 Telegram: @acme_bot                                        │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Pantalla de Configuración de Agentes

```
┌─────────────────────────────────────────────────────────────────┐
│  CONFIGURACIÓN DE AGENTES - ACME Corporation                    │
├─────────────────────────────────────────────────────────────────┤
│  MODELO Y PROVIDER                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Modelo:    [ GPT-4o ▼ ]                                │   │
│  │  Provider:  [ OpenAI ▼ ]                                │   │
│  │  Fallback:  [ Groq Llama 3 ▼ ]                          │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  PERSONALIDAD                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Nombre del agente: [ Alex ]                            │   │
│  │  Vibe:              [ Profesional pero cercano ▼ ]      │   │
│  │  Formalidad:        [ Usted ▼ ]                         │   │
│  │  Proactividad:      [ Media ▼ ]                         │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  CANALES ACTIVOS                                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  WhatsApp  🟢 Conectado    [ Configurar ] [ Desactivar ]│   │
│  │  Telegram  🟢 Conectado    [ Configurar ] [ Desactivar ]│   │
│  │  Email     🟢 Conectado    [ Configurar ] [ Desactivar ]│   │
│  │  Slack     🔴 Desconectado [ Configurar ]              │   │
│  └─────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────┤
│  PROMPTS PERSONALIZADOS                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  [ System Prompt - Saludo inicial ]                     │   │
│  │  [ Respuesta a objeciones comunes ]                     │   │
│  │  [ Follow-up post-venta ]                               │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. FOMO Team OpenClaw

### 5.1 Configuración de la Instancia Compartida

```yaml
# Instancia: fomo.fomo.com.ar (puerto 3000)
# Usuarios: Mariano + Guillermina (socios)

SOUL.md:
  - Rol: Chief of Staff AI para FOMO
  - Personalidad: Directa, proactiva, orientada a resultados
  - Límites claros entre contexto personal vs empresa

Multi-user:
  - Identificación por user_id en cada mensaje
  - Contexto separado por usuario
  - Memoria compartida de empresa
  - Memoria privada por usuario
```

### 5.2 Separación de Contexto

```typescript
// Estructura de memoria multi-user
interface FomoTeamContext {
  // Memoria compartida (empresa)
  shared: {
    companyGoals: string[];
    activeClients: string[];
    metrics: Metrics;
    decisions: Decision[];
  };
  
  // Memoria por usuario
  users: {
    [userId: string]: {
      personalTasks: Task[];
      preferences: UserPreferences;
      privateNotes: string[];
    }
  }
}

// En cada interacción:
// 1. Cargar contexto compartido
// 2. Cargar contexto personal del usuario
// 3. Responder considerando ambos contextos
// 4. Guardar actualizaciones según corresponda
```

---

## 6. Agente de Guillermina

### 6.1 Instancia Separada

```yaml
# Instancia: guille.fomo.com.ar (puerto separado)
# Propósito: Herramienta personal para configurar/testear agentes de clientes

Características:
  - Acceso directo a fomo-core API
  - Capacidad de crear/editar agentes remotamente
  - Testeo de prompts y configuraciones
  - Acceso a logs de clientes (solo con permiso)
```

### 6.2 Integración con fomo-core API

```typescript
// Capacidades del agente de Guillermina vía chat

interface GuillerminaAgentCapabilities {
  // Gestión de clientes
  "Crear nuevo cliente": (params: ClientParams) => Promise<Client>;
  "Listar clientes": () => Promise<Client[]>;
  "Ver estado de instancia": (clientId: string) => Promise<InstanceStatus>;
  
  // Configuración de agentes
  "Actualizar prompt": (clientId: string, prompt: string) => Promise<void>;
  "Cambiar modelo": (clientId: string, model: string) => Promise<void>;
  "Activar canal": (clientId: string, channel: Channel) => Promise<void>;
  
  // Testing
  "Testear respuesta": (clientId: string, message: string) => Promise<Response>;
  "Ver logs recientes": (clientId: string, lines: number) => Promise<Log[]>;
}

// Ejemplo de uso por WhatsApp:
// Guillermina: "Crear cliente NuevoCorp, rubro software, ventas"
// Agente: "✅ Cliente creado. URL: https://nuevocorp.fomo.com.ar"
// 
// Guillermina: "Cambiar prompt de NuevoCorp a uno más formal"
// Agente: "✅ Prompt actualizado. ¿Querés testearlo?"
```

---

## 7. Riesgos y Mitigaciones

### 7.1 ¿Qué pasa si el VPS cae?

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| **Caída total VPS** | Alto - Todos los clientes offline | Backup diario en S3 + playbook de restore en <30 min en VPS alternativo |
| **Caída de un contenedor** | Medio - Un cliente offline | Auto-restart por Docker + alerta a Guillermina |
| **Corrupción de datos** | Alto - Pérdida de configuración | Backup incrementales cada 6h + snapshots diarios |
| **Ataque de seguridad** | Alto - Datos expuestos | Network isolation + secrets encriptados + WAF |

### 7.2 Estrategia de Backup

```yaml
# Backup de configuraciones
Schedule:
  - Incremental: Cada 6 horas
  - Full: Diario a las 3 AM UTC
  - Retención: 30 días

Contenido:
  - /var/lib/docker/volumes/*/  # Volúmenes de datos
  - Configuraciones de instancias (DB)
  - Secrets (encriptados)
  - Templates

Destino:
  - Primario: S3 (AWS o R2)
  - Secundario: VPS alternativo
```

### 7.3 Monitoreo de Health

```yaml
# Health checks por instancia
Check every: 30s
Timeout: 5s
Retries: 3

Endpoints:
  - /health (HTTP 200)
  - /health/detailed (incluye recursos)

Alertas:
  - Instance down > 2 min → Telegram a Guillermina
  - Memory > 80% → Warning
  - Memory > 95% → Critical + auto-restart
  - Disk > 85% → Warning
```

### 7.4 Runbook de Disaster Recovery

```
1. DETECTAR FALLA
   └─> Health check falla 3 veces consecutivas

2. NOTIFICAR
   └─> Alerta a Guillermina (Telegram)
   └─> Log en sistema de incidentes

3. INTENTAR AUTO-RECOVERY
   └─> Restart del contenedor (Docker)
   └─> Si falla → Escalar a manual

4. RECOVERY MANUAL (si auto-falla)
   a. Verificar estado del VPS
   b. Si VPS OK: Recrear contenedor desde último backup
   c. Si VPS down: Activar VPS failover
   
5. VALIDAR
   └─> Health check pasa
   └─> Canales responden
   └─> Notificar a cliente (si aplica)

RTO (Recovery Time Objective): 30 minutos
RPO (Recovery Point Objective): 6 horas máximo
```

---

## Tickets de Desarrollo Generados

### Backend (fomo-core)
1. **FOC-101**: Crear tablas DB (openclaw_instances, openclaw_channels, openclaw_secrets)
2. **FOC-102**: Implementar ProvisioningClient con auth HMAC
3. **FOC-103**: API endpoints para gestión de instancias
4. **FOC-104**: Webhook handlers para WhatsApp/Telegram

### Provisioning Service
5. **PROV-101**: Setup inicial del servicio Node.js
6. **PROV-102**: Docker Engine integration (socket API)
7. **PROV-103**: Template rendering engine
8. **PROV-104**: Container lifecycle management (create/start/stop/delete)
9. **PROV-105**: Health monitoring service
10. **PROV-106**: Log aggregation

### Frontend (fomo-platform)
11. **FOP-101**: UI wizard de provisioning (5 pasos)
12. **FOP-102**: Pantalla de configuración de agentes
13. **FOP-103**: Dashboard de estado de instancias
14. **FOP-104**: Channel activation flows

### DevOps
15. **OPS-101**: Docker base image para OpenClaw
16. **OPS-102**: Nginx reverse proxy config
17. **OPS-103**: Backup automation scripts
18. **OPS-104**: Monitoring setup (Prometheus/Grafana o similar)
19. **OPS-105**: VPS failover playbook

### Integraciones
20. **INT-101**: Meta WhatsApp Business API integration
21. **INT-102**: Telegram Bot API integration

---

## Checklist de Lanzamiento (10 clientes iniciales)

- [ ] Provisioning service deployado y testeado
- [ ] Base de datos migrada con tablas nuevas
- [ ] Nginx configurado con wildcard SSL (*.fomo.com.ar)
- [ ] Primer cliente de prueba funcionando end-to-end
- [ ] Backups automáticos configurados y testeados
- [ ] Monitoreo activo con alerting
- [ ] Runbook de disaster recovery documentado
- [ ] Guillermina entrenada en uso del dashboard
- [ ] Agentes de los 10 clientes creados y configurados

---

*Documento generado por arquitectura FOMO - 2026-03-16*
