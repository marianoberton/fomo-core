# Task: Config Loader — Branch `feature/config-loader`

## Instrucciones para el agente

Vas a trabajar en el proyecto **Nexus Core** en la branch `feature/config-loader`.
Tu tarea es implementar el sistema de carga y validación de configuración de proyectos.

**IMPORTANTE**: Solo tocás archivos dentro de `src/config/`. NO modifiques nada fuera de esa carpeta.
Otro agente trabaja en paralelo en otra branch y cualquier cambio fuera de `src/config/` genera conflictos de merge.

---

## Setup inicial

```bash
cd c:\Users\Mariano\Documents\fomo-core
git checkout -b feature/config-loader
```

---

## Contexto del proyecto

- **Stack**: Node.js 22, TypeScript strict, ESM (`"type": "module"`), pnpm, Zod, Vitest
- **Path alias**: `@/*` mapea a `./src/*` — los imports locales DEBEN usar extensión `.js`
- **ESLint**: `strictTypeChecked` — zero `any`, `explicit-function-return-type`, `no-console`
- **Patrón**: Factory functions (no clases), named exports only (no default exports)
- **`verbatimModuleSyntax: true`**: los imports de solo tipos DEBEN usar `import type`

---

## Estado actual de `src/config/`

### `src/config/types.ts` (NO MODIFICAR — solo referenciar)
```typescript
import type { AgentConfig } from '@/core/types.js';

export interface ProjectConfig {
  id: string;
  name: string;
  description?: string;
  environment: 'production' | 'staging' | 'development';
  owner: string;
  tags: string[];
  agentConfig: AgentConfig;
  status: 'active' | 'paused' | 'deleted';
  createdAt: Date;
  updatedAt: Date;
}
```

### `src/config/index.ts` (MODIFICAR — agregar exports)
```typescript
export type { ProjectConfig } from './types.js';
```

---

## Tipos del core que necesitás referenciar

### `AgentConfig` (de `src/core/types.ts` — NO MODIFICAR)
```typescript
export interface AgentConfig {
  projectId: ProjectId;
  agentRole: string;
  provider: LLMProviderConfig;
  fallbackProvider?: LLMProviderConfig;
  failover: FailoverConfig;
  allowedTools: string[];
  memoryConfig: MemoryConfig;
  costConfig: CostConfig;
  maxTurnsPerSession: number;
  maxConcurrentSessions: number;
}

export interface LLMProviderConfig {
  provider: 'anthropic' | 'openai' | 'google' | 'ollama';
  model: string;
  temperature?: number;
  maxOutputTokens?: number;
  apiKeyEnvVar?: string;
  baseUrl?: string;
}

export interface FailoverConfig {
  onRateLimit: boolean;
  onServerError: boolean;
  onTimeout: boolean;
  timeoutMs: number;
  maxRetries: number;
}

export interface MemoryConfig {
  longTerm: {
    enabled: boolean;
    maxEntries: number;
    retrievalTopK: number;
    embeddingProvider: string;
    decayEnabled: boolean;
    decayHalfLifeDays: number;
  };
  contextWindow: {
    reserveTokens: number;
    pruningStrategy: 'turn-based' | 'token-based';
    maxTurnsInContext: number;
    compaction: {
      enabled: boolean;
      memoryFlushBeforeCompaction: boolean;
    };
  };
}

export interface CostConfig {
  dailyBudgetUSD: number;
  monthlyBudgetUSD: number;
  maxTokensPerTurn: number;
  maxTurnsPerSession: number;
  maxToolCallsPerTurn: number;
  alertThresholdPercent: number;
  hardLimitPercent: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}
```

`ProjectId` es un branded type `Brand<string, 'ProjectId'>` — para los schemas Zod usá `z.string()` y luego casteá con `as ProjectId` al retornar.

---

## Archivos a crear

### 1. `src/config/schema.ts` — Zod schemas de validación

Crear schemas Zod que validen la estructura completa de configuración. Esto permite validar archivos JSON de configuración antes de usarlos.

```typescript
/**
 * Zod schemas for validating project configuration files.
 * These schemas mirror the TypeScript interfaces in core/types.ts
 * and config/types.ts, providing runtime validation.
 */
import { z } from 'zod';

// Schema para LLMProviderConfig
export const llmProviderConfigSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'google', 'ollama']),
  model: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  apiKeyEnvVar: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
});

// Schema para FailoverConfig
export const failoverConfigSchema = z.object({
  onRateLimit: z.boolean(),
  onServerError: z.boolean(),
  onTimeout: z.boolean(),
  timeoutMs: z.number().int().positive(),
  maxRetries: z.number().int().min(0).max(10),
});

// Schema para MemoryConfig
export const memoryConfigSchema = z.object({
  longTerm: z.object({
    enabled: z.boolean(),
    maxEntries: z.number().int().positive(),
    retrievalTopK: z.number().int().positive(),
    embeddingProvider: z.string().min(1),
    decayEnabled: z.boolean(),
    decayHalfLifeDays: z.number().positive(),
  }),
  contextWindow: z.object({
    reserveTokens: z.number().int().positive(),
    pruningStrategy: z.enum(['turn-based', 'token-based']),
    maxTurnsInContext: z.number().int().positive(),
    compaction: z.object({
      enabled: z.boolean(),
      memoryFlushBeforeCompaction: z.boolean(),
    }),
  }),
});

// Schema para CostConfig
export const costConfigSchema = z.object({
  dailyBudgetUSD: z.number().positive(),
  monthlyBudgetUSD: z.number().positive(),
  maxTokensPerTurn: z.number().int().positive(),
  maxTurnsPerSession: z.number().int().positive(),
  maxToolCallsPerTurn: z.number().int().positive(),
  alertThresholdPercent: z.number().min(0).max(100),
  hardLimitPercent: z.number().min(0).max(200),
  maxRequestsPerMinute: z.number().int().positive(),
  maxRequestsPerHour: z.number().int().positive(),
});

// Schema para AgentConfig
export const agentConfigSchema = z.object({
  projectId: z.string().min(1),
  agentRole: z.string().min(1),
  provider: llmProviderConfigSchema,
  fallbackProvider: llmProviderConfigSchema.optional(),
  failover: failoverConfigSchema,
  allowedTools: z.array(z.string().min(1)),
  memoryConfig: memoryConfigSchema,
  costConfig: costConfigSchema,
  maxTurnsPerSession: z.number().int().positive(),
  maxConcurrentSessions: z.number().int().positive(),
});

// Schema para ProjectConfig (archivo JSON completo)
export const projectConfigFileSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  environment: z.enum(['production', 'staging', 'development']),
  owner: z.string().min(1),
  tags: z.array(z.string()),
  agentConfig: agentConfigSchema,
});
```

**Notas:**
- El schema de `ProjectConfig` para archivo NO incluye `status`, `createdAt`, `updatedAt` — esos los pone el sistema
- El `projectId` dentro de `agentConfig` debe coincidir con el `id` del proyecto — agregá un `.refine()` para esto
- JSDoc en cada schema exportado

### 2. `src/config/loader.ts` — Carga y validación

```typescript
/**
 * Configuration loader — reads JSON config files, validates with Zod,
 * and resolves environment variable placeholders.
 */
```

Funciones a implementar:

#### `resolveEnvVars(obj: unknown): unknown`
- Recorre recursivamente un objeto JSON
- Reemplaza strings con pattern `${VAR_NAME}` por `process.env['VAR_NAME']`
- Si la env var no existe, tira `ConfigError` con detalle de cuál falta
- Solo reemplaza en valores string, no en keys
- Soporta el pattern completo `${...}` (no parcial — el string entero es `${VAR}`)

#### `loadProjectConfig(filePath: string): Promise<Result<ProjectConfigFile, NexusError>>`
- Lee el archivo con `node:fs/promises` (`readFile`)
- Parsea JSON (catch SyntaxError → error descriptivo)
- Resuelve env vars con `resolveEnvVars()`
- Valida con `projectConfigFileSchema.safeParse()`
- Retorna `Result<T, E>` pattern (importar de `@/core/result.js`)
- NO lanza excepciones — todo vía Result

#### `ConfigError` class
- Extends `NexusError` (importar de `@/core/errors.js`)
- Code: `'CONFIG_ERROR'`
- StatusCode: 400

#### Tipo `ProjectConfigFile`
- Inferido del schema: `z.infer<typeof projectConfigFileSchema>`
- Exportar como type

**Patrón Result a usar:**
```typescript
import type { Result } from '@/core/result.js';
import { ok, err } from '@/core/result.js';
// return ok(value) para éxito
// return err(new ConfigError('message')) para error
```

### 3. `src/config/schema.test.ts` — Tests de schemas

Tests con Vitest. Patrón:
```typescript
import { describe, it, expect } from 'vitest';
import { agentConfigSchema, projectConfigFileSchema, /* etc */ } from './schema.js';

describe('llmProviderConfigSchema', () => {
  it('accepts valid anthropic config', () => { ... });
  it('rejects invalid provider', () => { ... });
  it('rejects empty model', () => { ... });
  it('accepts config without optional fields', () => { ... });
});

// Similar para cada schema...
```

Mínimo **15 tests** cubriendo:
- Cada schema acepta input válido
- Cada schema rechaza input inválido (campo faltante, tipo incorrecto)
- Campos opcionales funcionan cuando están ausentes
- Validaciones de rango (temperature 0-2, alertThreshold 0-100, etc.)
- `projectConfigFileSchema` rechaza projectId vacío

### 4. `src/config/loader.test.ts` — Tests del loader

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
```

Tests mínimos (**12+ tests**):

**`resolveEnvVars`:**
- Reemplaza `${VAR}` con el valor de env
- Maneja objetos anidados
- Maneja arrays
- Deja strings sin `${}` intactos
- Tira error si la env var no existe
- No modifica números ni booleans

**`loadProjectConfig`:**
- Carga y valida un config válido (usar `vi.mock('node:fs/promises')` o escribir a un temp file)
- Retorna error si el archivo no existe
- Retorna error si el JSON es inválido
- Retorna error si la validación Zod falla
- Resuelve env vars antes de validar
- El `projectId` en agentConfig debe coincidir con `id`

**IMPORTANTE sobre mocks de fs:**
```typescript
import { vi } from 'vitest';
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));
```

### 5. `src/config/index.ts` — Actualizar barrel

```typescript
export type { ProjectConfig } from './types.js';
export type { ProjectConfigFile } from './loader.js';
export {
  agentConfigSchema,
  projectConfigFileSchema,
  llmProviderConfigSchema,
  failoverConfigSchema,
  memoryConfigSchema,
  costConfigSchema,
} from './schema.js';
export { loadProjectConfig, resolveEnvVars, ConfigError } from './loader.js';
```

---

## Reglas ESLint que DEBÉS respetar

1. **Zero `any`** — usá `unknown` + type narrowing
2. **`explicit-function-return-type`** — TODAS las funciones exportadas deben tener return type explícito
3. **`no-console`** — NO usar `console.log`. Si necesitás logging, importá `createLogger` de `@/observability/logger.js`
4. **`verbatimModuleSyntax`** — imports de solo tipo: `import type { X } from '...'`
5. **`.js` extension** en TODOS los imports locales: `from './schema.js'`, `from '@/core/result.js'`
6. **Named exports only** — NO usar `export default`
7. **`no-unused-vars`** — si un parámetro de interfaz no se usa, poné `void param;` como primera línea
8. **`catch {`** — si no usás la variable de error en un catch, usá `catch {` sin variable
9. **`no-non-null-assertion`** — no uses `!`. Usá null guard + type narrowing
10. **`restrict-template-expressions`** — solo `number` y `boolean` en template literals. Para otros tipos, convertí a string explícitamente

---

## Ejemplo de test existente (para copiar el estilo)

```typescript
import { describe, it, expect } from 'vitest';

describe('costConfigSchema', () => {
  it('accepts valid cost config', () => {
    const result = costConfigSchema.safeParse({
      dailyBudgetUSD: 10,
      monthlyBudgetUSD: 100,
      maxTokensPerTurn: 4096,
      maxTurnsPerSession: 50,
      maxToolCallsPerTurn: 10,
      alertThresholdPercent: 80,
      hardLimitPercent: 100,
      maxRequestsPerMinute: 60,
      maxRequestsPerHour: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative daily budget', () => {
    const result = costConfigSchema.safeParse({
      dailyBudgetUSD: -5,
      // ... rest of fields
    });
    expect(result.success).toBe(false);
  });
});
```

---

## Verificación final

Cuando termines, ejecutá:

```bash
pnpm typecheck              # 0 errores
pnpm lint:fix               # ESLint limpio
pnpm test -- --run src/config/   # Todos los tests de config pasan
pnpm test                   # Todos los tests del proyecto pasan (543+ existentes + los nuevos)
```

Luego commit y push:

```bash
git add src/config/
git commit -m "feat(config): add config loader with Zod validation and env var resolution

- Add Zod schemas for AgentConfig, ProjectConfig, and all sub-configs
- Implement loadProjectConfig() to read/validate JSON config files
- Implement resolveEnvVars() for \${VAR_NAME} placeholder substitution
- Add ConfigError class extending NexusError
- Add comprehensive tests for schemas and loader

Co-Authored-By: Claude <noreply@anthropic.com>"
git push -u origin feature/config-loader
```

---

## Resumen

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `src/config/schema.ts` | CREAR | Zod schemas para toda la config |
| `src/config/loader.ts` | CREAR | loadProjectConfig + resolveEnvVars + ConfigError |
| `src/config/schema.test.ts` | CREAR | 15+ tests de validación de schemas |
| `src/config/loader.test.ts` | CREAR | 12+ tests del loader |
| `src/config/index.ts` | MODIFICAR | Agregar exports nuevos |
| `src/config/types.ts` | NO TOCAR | Ya existe, solo referenciar |

**NO toques NINGÚN archivo fuera de `src/config/`.** Otro agente trabaja en paralelo en `src/api/routes/` y cualquier cambio fuera genera conflictos.
