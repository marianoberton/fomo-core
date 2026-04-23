# Plan 002 — Edición de entries de knowledge

## Contexto

Hoy las knowledge cards del dashboard solo permiten **ver (truncado)** y **borrar**. No hay forma de editar el contenido, importancia, categoría o scope de una entry existente. La única vía de edición es SQL directo contra la DB o borrar + recrear, que pierde el `id`, `created_at` y `access_count`.

**Repo:** `fomo-core-dashboard` (submódulo en `/dashboard`)
**Backend:** `fomo-core` (tabla `memory_entries`)
**Pre-requisito:** Plan 001 ejecutado (ConfirmDialog reusable puede existir y reutilizarse).

## Dependencia crítica — verificar ANTES de escribir UI

El backend puede no tener endpoint de edición. El agente **debe verificar primero** si existe:

```bash
# Desde la raíz de fomo-core (no dashboard)
grep -rn "memory_entries\|memoryEntries\|MemoryEntry" src/api/routes/ --include="*.ts" | head -30
grep -rn "\.patch\|\.put" src/api/routes/ --include="*.ts" | grep -i memory | head -20
```

Endpoints esperados (alguna variante debe existir):

- `PATCH /api/v1/projects/:projectId/memory/:id`
- `PUT /api/v1/projects/:projectId/memory/:id`
- `PATCH /api/v1/memory/:id`

**Si no existe endpoint de update → PARAR.** No proceder con la UI. Reportar en el chat y esperar decisión:

- Opción A: crear primero el endpoint en fomo-core (fuera de scope de este plan, requiere plan nuevo).
- Opción B: workaround temporal (DELETE + CREATE). Cambia el id y pierde access_count — mala UX.

El agente no decide esto solo. Reporta y espera.

## Dependencia crítica — re-embedding del content

Si el endpoint de update existe, verificar si regenera el `embedding` cuando se edita `content`:

```bash
# Buscar lógica de embedding en el service
grep -rn "embedding\|generateEmbedding\|embed" src/services/ src/memory/ --include="*.ts" | head -30
```

Si el endpoint NO regenera embedding automáticamente → la edición sería un bug silencioso (el texto cambia pero el semantic search responde al texto viejo). El agente debe reportarlo como blocker, no avanzar con la UI hasta que el backend regenere embedding en cada update de content.

## Objetivo

Cuando el usuario haga click en un nuevo botón **Edit** en una knowledge card:

1. Abrir un modal con un form pre-poblado con los valores actuales de la entry.
2. Campos editables: `content`, `category`, `importance`, `scope`, `agent_id` (condicional), `expires_at`, `metadata`.
3. Campos read-only visibles: `id`, `created_at`, `access_count`, `last_accessed_at`.
4. Validación frontend antes de enviar.
5. Al guardar: PATCH al backend, cerrar modal, invalidar la lista, mostrar la card actualizada.
6. Botón Cancelar descarta los cambios sin confirmación si no hay diffs. Si hay diffs sin guardar → confirmación "¿Descartar cambios?".

## Scope

### Archivos a tocar (allowlist)

- Componente de knowledge card (mismo que tocó el plan 001).
- Nuevo componente `KnowledgeEditDialog.tsx` (o equivalente según patrón del repo).
- Hook o mutation para PATCH de knowledge entries.
- Si no existe, client de API para el endpoint de update.

### Archivos que NO tocar (denylist estricta)

- Backend `fomo-core` — este plan es **solo UI**. Si el endpoint no existe o no regenera embedding, se pausa, no se arregla acá.
- Delete logic del plan 001 — no refactorizar, solo coexistir.
- Otros módulos del dashboard (prompts, tools, agents, sessions).
- Lógica de creación de knowledge entries (POST) — ese es otro flujo, fuera de scope.

## Referencias obligatorias

Leer en orden antes de empezar:

1. `.claude/skills/frontend-fomo.md`
2. `.claude/plans/001-knowledge-delete-confirm.md` (para reutilizar patrón de Dialog si aplica)
3. Este archivo completo

## Exploración inicial

Antes de escribir UI:

1. **Verificar endpoint de update** (ver sección Dependencia crítica arriba).
2. **Verificar re-embedding automático** (ver sección Dependencia crítica arriba).
3. **Identificar el client de API** del dashboard (probable `src/lib/api/` o similar).
4. **Revisar si el plan 001 creó un Dialog reusable.** Si sí → usar ese patrón. Si no → crear un componente base.
5. **Identificar patrón de form** en el dashboard (react-hook-form, nativo, etc.) y reutilizarlo.

## Campos y validaciones

| Campo | Tipo UI | Validación | Notas |
|---|---|---|---|
| `content` | Textarea, min 8 rows, autogrow | Requerido, min 10 chars, max 10000 chars | Si cambia, triggear re-embedding en backend |
| `category` | Input con autocomplete (o select con opciones) | Requerido, slug-style (lowercase, no espacios) | Opciones sugeridas: `instructions`, `faq`, `product`, `sales`, `identity`, `safety`, `policy`, `example` — permitir custom |
| `importance` | Slider 0-1 con display numérico (2 decimales) | 0 ≤ x ≤ 1 | Labels visuales: `low (0-0.3)`, `medium (0.3-0.7)`, `high (0.7-1.0)` |
| `scope` | Radio group: `project` / `agent` | Requerido | Si `agent` → mostrar selector de agent_id debajo |
| `agent_id` | Select poblado con agents del proyecto | Requerido si `scope === 'agent'`, oculto si `scope === 'project'` | Fetch de agents del proyecto |
| `expires_at` | DateTime picker opcional | Opcional | Default null = sin expiración |
| `metadata` | Textarea JSON (opcional, collapse por default) | Debe parsear como JSON válido si no está vacío | UX avanzada, no exponer prominente |

**Read-only (mostrar deshabilitado):**

- `id` — copiable con botón de copy
- `created_at` — formato legible
- `last_accessed_at` — formato legible
- `access_count` — número

## Plan de implementación

1. **Client API:** agregar función `updateMemoryEntry(projectId, id, patch)` que hace PATCH al endpoint identificado en la exploración.
2. **Hook/Mutation:** agregar mutation en el store o React Query (según patrón del dashboard) con invalidación de la lista de knowledge al success.
3. **Botón Edit en la card:** al lado del botón Delete. Icon-only si el espacio es limitado (pencil icon).
4. **`KnowledgeEditDialog`:** modal con el form. Usa el mismo Dialog primitive del plan 001.
5. **Form state:** inicializado con los valores actuales de la entry.
6. **Dirty tracking:** si el usuario intenta cerrar con cambios → confirmación.
7. **Submit handler:** envía solo los campos modificados (diff), no el objeto entero. Para `content` modificado, el backend regenera embedding (verificado en exploración).
8. **Error handling:** si el PATCH falla, mostrar toast de error + dejar el modal abierto con los cambios.
9. **Success handler:** cerrar modal + refetch de la lista + toast de éxito.

## Decisiones ya tomadas (revisar si no te convencen)

- **Category es input con sugerencias, no select cerrado.** Rationale: el schema es free-form, los valores conocidos son convenciones que pueden crecer. Un select cerrado obliga a releases del frontend cada vez que aparece una categoría nueva.
- **Importance es slider, no input numérico.** Rationale: el valor es 0-1 continuo con significado semántico (low/medium/high). Slider comunica mejor ese rango.
- **Scope es radio, no dropdown.** Rationale: son solo dos opciones con implicancia estructural (scope='agent' requiere agent_id). Radio lo hace explícito.
- **Metadata collapsed por default.** Rationale: es avanzado, la mayoría de entries no lo usa.

## Criterios de éxito

- [ ] Botón Edit visible en cada knowledge card.
- [ ] Click en Edit abre modal con datos actuales pre-poblados.
- [ ] Cambiar `content` → guardar → recargar página → el nuevo content persiste.
- [ ] Cambiar `importance` con slider → guardar → valor persiste.
- [ ] Cambiar `scope` de `project` a `agent` → aparece selector de agent_id → requerido.
- [ ] Cambiar `scope` de `agent` a `project` → selector de agent_id desaparece y se envía null.
- [ ] Cerrar modal con cambios sin guardar → confirmación "Descartar cambios?".
- [ ] Cerrar modal sin cambios → cierra directo, sin confirmación.
- [ ] Error del backend → toast visible, modal sigue abierto.
- [ ] `pnpm typecheck` pasa.
- [ ] `pnpm build` pasa.
- [ ] No console errors al abrir / editar / cerrar.

## Validación manual

1. Crear entry de prueba: `category: test`, `content: "prueba 002"`, `importance: 0.5`, `scope: project`.
2. Click Edit → el modal aparece con esos valores.
3. Cambiar content a `"prueba 002 editada"` → guardar → la card muestra el nuevo content.
4. Refrescar la página → el content editado persiste (no se revirtió).
5. Click Edit otra vez → cambiar importance a 0.9 → guardar → verificar que la card / filtros reflejan la nueva importance.
6. Cambiar scope a `agent` → el selector de agent aparece → seleccionar FAMA - Web → guardar.
7. Refrescar → la entry ahora está asociada al agente, no al proyecto.
8. Click Edit, modificar content pero cerrar con X → aparece "Descartar cambios?" → cancelar → modal sigue abierto con cambios.
9. **Extra — validar semantic search:** abrir Test Chat del agente y hacer una query que debería matchear el content editado. Si matchea, el re-embedding funcionó. Si sigue devolviendo contenido viejo, el backend no está regenerando embedding (blocker).

## Rollback

Cambios puramente de UI (frontend dashboard). Rollback = `git revert <commit>`.

Ninguna migración ni cambio de schema. El endpoint PATCH es del backend y no se toca acá.

## Fuera de scope (explícito, no expandir)

- Crear o modificar endpoint PATCH en el backend (plan separado si hace falta).
- Lógica de re-embedding en el backend (plan separado si hace falta).
- Bulk edit de múltiples entries.
- Historial de cambios / versioning.
- Diff viewer antes de guardar.
- Agregar campos nuevos al schema.
- Tocar el flow de creación (POST) de knowledge entries.
- Tocar el delete (plan 001 lo cubre).

## Entrega

Al terminar:

1. **No hacer commit ni push.**
2. Pegar resumen en el chat:
   - Resultado de la exploración inicial (endpoint existe? regenera embedding?).
   - Archivos modificados / creados.
   - Output de `pnpm typecheck` y `pnpm build`.
   - Instrucciones de test manual (copiar de la sección Validación manual).
3. Si durante la exploración aparecieron blockers (no hay endpoint, no regenera embedding), el agente para ahí y reporta — no improvisa workaround.
4. Esperar review antes de commit.

---

**Autor del plan:** Mariano (via Claude Opus 4.7)
**Modelo recomendado para ejecutar:** Sonnet 4.6 para UI. Escalar a Opus si la exploración del backend encuentra algo no trivial.
**Modo:** `--dangerously-skip-permissions` ok — scope acotado, sin operaciones destructivas.
**Ejecutar DESPUÉS del plan 001.**