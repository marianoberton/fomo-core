# BUGS.md - Nexus Core Stabilization

**Branch:** `feat/nexus-core-stabilization`  
**Fecha:** 2026-02-15  
**Tester:** Claude (subagent)

---

## 🔴 CRÍTICO (Bloquea Demo)

### BUG-001: Provider config schema mismatch
**Severidad:** CRÍTICA  
**Componente:** `prisma/seed.ts`, `src/core/types.ts`  
**Estado:** ✅ FIXED

**Descripción:**  
El seed de la base de datos usa `type: "anthropic"` pero `LLMProviderConfig` y `createProvider()` esperan `provider: "anthropic"`. Esto causa que el chat endpoint falle con:

```
{"code":"PROVIDER_ERROR","message":"LLM provider \"undefined\" error: Unknown provider: undefined"}
```

**Pasos para reproducir:**
1. `pnpm db:seed`
2. `pnpm dev`
3. `POST /api/v1/projects/{projectId}/sessions` → crea sesión
4. `POST /api/v1/chat` con `{"projectId": "...", "sessionId": "...", "message": "hello"}`
5. Error: Provider undefined

**Archivo afectado:**
```typescript
// prisma/seed.ts línea 19
provider: {
  type: 'anthropic',  // ❌ INCORRECTO
  ...
}

// Debería ser:
provider: {
  provider: 'anthropic',  // ✅ CORRECTO
  ...
}
```

**Fix propuesto:**
```diff
// prisma/seed.ts
configJson: {
  provider: {
-   type: 'anthropic',
+   provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
-   maxTokens: 4096,
+   apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    temperature: 0.7,
  },
```

---

### BUG-002: AgentConfig schema inconsistency
**Severidad:** CRÍTICA  
**Componente:** `src/core/types.ts`, seed data  
**Estado:** ✅ FIXED

**Descripción:**  
El schema `AgentConfig` espera campos específicos pero el seed usa una estructura diferente:

| Campo esperado | Campo en seed |
|----------------|---------------|
| `provider: LLMProviderConfig` | `provider: { type: ... }` |
| `allowedTools: string[]` | `tools.allowedTools` |
| `memoryConfig: MemoryConfig` | `memory: { ... }` |
| `costConfig: CostConfig` | `cost: { ... }` |

**Fix propuesto:**  
Unificar el schema entre lo que guarda el seed y lo que espera el runtime.

---

## 🟡 ALTO

### BUG-003: Tests de integración hardcodean puerto 5433
**Severidad:** ALTA  
**Componente:** `src/testing/helpers/test-database.ts`  
**Estado:** ABIERTO

**Descripción:**  
Los tests de integración fallan cuando se ejecutan sin Docker porque `test-database.ts` tiene fallback hardcodeado a `localhost:5433`:

```typescript
const testDbUrl =
  process.env['TEST_DATABASE_URL'] ||
  'postgresql://nexus:nexus@localhost:5433/nexus_core_test?schema=public';
```

Aunque `.env.test` existe con la configuración correcta, los tests no la cargan automáticamente.

**Impacto:** 79 tests de integración fallan en entornos sin Docker.

**Fix propuesto:**  
1. Asegurar que vitest cargue `.env.test` automáticamente
2. O cambiar fallback a puerto estándar 5432

---

### BUG-004: Servidor se cierra inesperadamente
**Severidad:** ALTA  
**Componente:** `src/main.ts`  
**Estado:** POR INVESTIGAR

**Descripción:**  
El servidor de desarrollo se cierra con SIGKILL poco después de iniciar, sin mensajes de error en los logs. El health endpoint responde una vez y luego el proceso muere.

**Observaciones:**
- Ocurre solo en ciertos ambientes de ejecución
- No hay mensajes de error ni stack traces
- Los logs muestran arranque exitoso antes de cerrar

**Posibles causas:**
- OOM killer (descartado - hay memoria disponible)
- Sandbox limitations
- Bug en BullMQ/Redis connection handling

---

## 🟢 MEDIO

### BUG-005: Warning de versión Redis
**Severidad:** MEDIA  
**Componente:** BullMQ integration  
**Estado:** INFORMATIVO

**Descripción:**  
BullMQ muestra warning repetido 4 veces al iniciar:
```
It is highly recommended to use a minimum Redis version of 6.2.0
Current: 6.0.16
```

**Fix propuesto:** Actualizar Redis a 6.2+ o documentar requisito.

---

### BUG-006: OPENAI_API_KEY warning incluso cuando no se usa
**Severidad:** MEDIA  
**Componente:** `src/memory/embeddings.ts`  
**Estado:** INFORMATIVO

**Descripción:**  
El sistema muestra warning de `OPENAI_API_KEY not set` incluso cuando el proyecto usa Anthropic y no necesita embeddings.

**Fix propuesto:** Solo mostrar warning si `longTerm.enabled: true` en config.

---

## 🔵 BAJO

### BUG-007: Test exclusion pattern no funciona perfectamente
**Severidad:** BAJA  
**Componente:** `vitest.config.ts`  
**Estado:** ABIERTO

**Descripción:**  
`pnpm test:unit` incluye archivos `.integration.test.ts` que deberían estar excluidos.

---

## ✅ FUNCIONANDO CORRECTAMENTE

### Tests que pasan:
- **Tools tests:** 169/169 ✅
- **Security tests:** 30/30 ✅
- **API route tests:** 124/124 ✅
- **Unit tests (sin DB):** 806/896 ✅

### Endpoints verificados funcionando:
- `GET /health` ✅
- `GET /api/v1/projects` ✅
- `GET /api/v1/projects/:id/prompt-layers` ✅
- `GET /api/v1/projects/:id/prompt-layers/active` ✅
- `POST /api/v1/projects/:id/sessions` ✅
- `GET /api/v1/tools` ✅
- `GET /api/v1/approvals` ✅

### Tools verificados (unit tests pasan):
- ✅ calculator
- ✅ date-time  
- ✅ json-transform
- ✅ http-request
- ✅ knowledge-search
- ✅ send-notification
- ✅ propose-scheduled-task

### Sistema de seguridad:
- ✅ ApprovalGate funciona correctamente
- ✅ InputSanitizer detecta prompt injections
- ✅ RBAC enforcement en ToolRegistry

---

## Próximos pasos

1. **FIX BUG-001 y BUG-002** - Crítico para demo
2. **FIX BUG-003** - Para CI/CD sin Docker
3. Investigar BUG-004 en ambiente de producción
4. Test end-to-end del flujo de chat una vez fijado BUG-001
