# Bugs y Issues Encontrados - Nexus Core Stabilization

**Fecha:** 2026-02-15  
**Branch:** `feat/nexus-core-stabilization`  
**Tester:** Subagent (automated testing)

---

## 🔴 Bloqueante: API Key Requerida

**Severidad:** HIGH  
**Estado:** Bloqueante para testing completo

### Descripción
El flujo completo de chat (create project → send message → get response) no puede ser probado sin una `ANTHROPIC_API_KEY` válida en el `.env`.

### Reproducción
```bash
curl -X POST http://localhost:3000/api/v1/chat \
  -H "Content-Type: application/json" \
  -d '{
    "projectId": "41re-1NjXtFu70hmOjC6x",
    "message": "Calculate 15 * 23 using the calculator tool"
  }'
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "PROVIDER_ERROR",
    "message": "LLM provider \"anthropic\" error: Environment variable \"ANTHROPIC_API_KEY\" is not set or empty"
  }
}
```

### Solución
- Agregar una API key válida de Anthropic al `.env`, O
- Implementar un "mock provider" para testing local sin dependencia externa

---

## 🟡 Warning: Redis Version Antigua

**Severidad:** LOW  
**Estado:** No bloqueante, solo advertencia

### Descripción
BullMQ recomienda Redis >= 6.2.0, pero la instancia actual es 6.0.16.

### Logs
```
It is highly recommended to use a minimum Redis version of 6.2.0
Current: 6.0.16
```

### Impacto
- Funcionalidad actual no afectada
- Posibles features avanzadas de BullMQ no disponibles

### Solución
- Actualizar Redis a 6.2+ cuando sea posible

---

## 🟡 Shadow Database Permissions

**Severidad:** LOW  
**Estado:** Workaround aplicado

### Descripción
`pnpm db:migrate` falla al intentar crear la extensión pgvector en la shadow database de Prisma (requiere superuser).

### Error
```
Error: P3006
Migration `20260208153204_init` failed to apply cleanly to the shadow database. 
Error:
ERROR: permission denied to create extension "vector"
```

### Workaround
Usar `pnpm prisma migrate deploy` en vez de `pnpm db:migrate` para development.

### Solución Permanente
- Agregar script alternativo en `package.json`: `"db:migrate:dev": "prisma migrate deploy"`
- Documentar en README que `db:migrate` requiere permisos de superuser

---

## ✅ Tools Built-in: Funcionando

**Estado:** PASSING (5/7 tests exitosos)

### Tests Exitosos
1. ✅ **calculator**: `15 * 23` → `345`
2. ✅ **calculator**: `sqrt(144) + 10` → `22`
3. ✅ **date-time**: `now` operation
4. ✅ **json-transform**: `get` operation
5. ✅ **json-transform**: `set` operation

### Tests Fallidos (por input incorrecto, no bug)
1. ❌ **calculator**: `2 ^ 8` - El operador de exponente es `**`, no `^`
   - **Solución:** Documentar en tool description que usa `**` para potencias
2. ❌ **date-time**: formato requiere `date` parameter, no `timestamp`
   - **Solución:** Revisar documentación del schema del tool

---

## 📝 Mejoras Sugeridas

### 1. Prompt Layer Setup UX
**Problema:** Crear un proyecto requiere manualmente crear y activar 3 prompt layers (identity, instructions, safety) antes de poder usar el chat.

**Sugerencia:** Agregar un flag `--with-default-prompts` al endpoint de creación de proyectos que auto-cree layers básicos.

### 2. Health Check Extendido
**Problema:** `/health` solo retorna `{status: "ok"}`, no verifica conectividad a servicios críticos.

**Sugerencia:** Agregar `/health/detailed` que verifique:
- Postgres connectivity
- Redis connectivity  
- LLM provider API key presente
- Tool registry status

### 3. Port Conflict Handling
**Problema:** Si el puerto 3000 está en uso, el servidor falla con `EADDRINUSE` pero no sugiere solución.

**Sugerencia:** Detectar puerto en uso y sugerir usar `PORT=3001` en el error message.

---

## 🎯 Testing Coverage

### Completado
- [x] Levantar entorno (postgres + redis)
- [x] Instalación de dependencias (`pnpm install`)
- [x] Migraciones de DB (`prisma migrate deploy`)
- [x] Servidor corriendo (`pnpm dev`)
- [x] Health check (`/health` → OK)
- [x] Crear proyecto vía API
- [x] Crear prompt layers
- [x] Activar prompt layers
- [x] Tools built-in: calculator, date-time, json-transform

### Bloqueado (requiere API key)
- [ ] Test flujo completo: enviar mensaje → LLM response
- [ ] Test tool calls orquestados por LLM
- [ ] Test memory system
- [ ] Test cost tracking

### Pendiente (fuera de scope del Bloque 1)
- [ ] WebSocket streaming
- [ ] Scheduled tasks
- [ ] Multi-agent system
- [ ] Channel adapters (Telegram, WhatsApp, Slack)

---

## 🚀 Recomendaciones

1. **Para desarrollo local:** Implementar un mock LLM provider que retorne respuestas fijas para testing sin API key
2. **Para CI/CD:** Usar secrets de GitHub Actions para las API keys de testing
3. **Documentación:** Agregar en README.md los pasos de setup de prompt layers para nuevos proyectos
4. **Developer Experience:** Agregar un comando `pnpm seed:dev` que cree un proyecto completo con prompt layers de ejemplo

---

**Tests ejecutados por:** Subagent automated testing  
**Duración total:** ~4 minutos  
**Estado final:** ✅ Bloques 1-7 completados, bloqueado en flujo LLM por falta de API key
