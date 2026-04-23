# Plan 001 — Confirmación antes de borrar entries de knowledge

## Contexto

El botón **Delete** en las cards de knowledge entries del dashboard borra la entry inmediatamente sin pedir confirmación. Durante testing manual se perdió una entry real (`instructions` de FAMA - Web, recuperada manualmente desde backup). Esto es un bug crítico de UX que puede seguir causando pérdida de data.

**Repo:** `fomo-core-dashboard` (github.com/marianoberton/fomo-core-dashboard), submódulo en `/dashboard` del monorepo.
**Ruta de la vista afectada:** Dashboard → Projects → [project] → Agents → [agent] → Knowledge
**Componente probable:** card de knowledge entry en la vista Knowledge del agente.

## Objetivo

Cuando el usuario haga click en el botón delete de una card de knowledge, el sistema debe:

1. **NO ejecutar el delete inmediatamente.**
2. Abrir un modal de confirmación que muestre:
   - Un preview del contenido de la entry (primeros ~120 caracteres).
   - La categoría (`instructions`, `faq`, `product`, etc.).
   - Un warning visible de que la acción no se puede deshacer.
3. Dos botones claros: **Cancelar** (default, acción segura) y **Eliminar** (destructive, rojo).
4. Si Cancelar → cerrar modal, la entry permanece intacta.
5. Si Eliminar → ejecutar el delete, cerrar modal, actualizar la lista.

## Scope

### Archivos a tocar (allowlist)

- El componente que renderiza cada card de knowledge entry.
- El handler del botón delete en ese componente (o en el hook/store asociado).
- Si hace falta, importar un componente Dialog ya existente en el dashboard.

### Archivos que NO tocar (denylist estricta)

- Backend `fomo-core` (cualquier archivo fuera del directorio `dashboard/`).
- Endpoints de API de knowledge (el endpoint DELETE no cambia, sigue siendo destructivo del lado del server).
- Otros botones delete en el dashboard (prompts, tools, agents, sessions). Este plan es **solo** para knowledge.
- Lógica de servicios que no sea el handler del botón.
- Tests existentes si funcionan (agregar tests nuevos si hay pattern, no refactor).

## Referencias obligatorias

Antes de empezar, leer en este orden:

1. `.claude/skills/frontend-fomo.md` — design system, tokens, convenciones del dashboard.
2. Este archivo completo.

## Exploración inicial que debe hacer el agente

Antes de escribir código, el agente debe identificar:

1. **Dónde vive la vista Knowledge** del agente. Buscar por rutas tipo `src/app/**/knowledge/**` o componentes con "Knowledge" en el nombre.
2. **El componente que renderiza cada card.** Verificar si ya importa un componente Dialog/Modal reusable (probable shadcn/ui o similar).
3. **Cómo se dispara el delete hoy.** Ver si es un fetch directo, una mutation de React Query, una server action, o un store.
4. **Si existe ya algún componente de ConfirmDialog reusable** en el dashboard que pueda reutilizarse.

Si encuentra un `ConfirmDialog` reusable → usarlo.
Si no existe → crear uno mínimo y genérico, reusable para los próximos fixes (edit modal, delete en otros lugares).

## Plan de implementación

### Si existe ConfirmDialog reusable

1. Importarlo en el componente de la card.
2. Agregar state local `isConfirmOpen`.
3. El botón delete ahora solo hace `setIsConfirmOpen(true)`.
4. El ConfirmDialog recibe: título, mensaje con preview + category, label de botón destructivo ("Eliminar"), y callback `onConfirm` que ejecuta el delete real.
5. Después del delete exitoso: cerrar modal + invalidar/refetch la lista de knowledge.

### Si NO existe ConfirmDialog reusable

1. Crear `src/components/ui/ConfirmDialog.tsx` (o la carpeta que corresponda al patrón del repo).
2. Props mínimas: `open`, `onOpenChange`, `title`, `description`, `confirmLabel`, `cancelLabel` (opcional, default "Cancelar"), `variant` ("destructive" | "default"), `onConfirm`.
3. Usar el Dialog primitive ya existente en el design system (shadcn o lo que use el repo).
4. El botón destructivo debe usar los tokens de color del skill `frontend-fomo.md` (no hex hardcodeado).
5. Una vez creado, usarlo en el componente de knowledge card.

## Criterios de éxito

- [ ] Click en el botón delete de una knowledge card abre un modal, **no** borra inmediatamente.
- [ ] El modal muestra al menos: preview del contenido (≥80 chars), category, y label destructivo claro.
- [ ] Click en Cancelar cierra el modal y la entry sigue en la lista.
- [ ] Click en Eliminar ejecuta el delete real y la entry desaparece de la UI.
- [ ] `pnpm typecheck` pasa sin errores nuevos.
- [ ] `pnpm build` pasa sin errores nuevos.
- [ ] No hay console errors al abrir/cerrar el modal.
- [ ] Si se creó un ConfirmDialog reusable, es genérico (no habla de knowledge específicamente).

## Validación manual (al terminar, antes de considerar done)

El agente debe dejar instrucciones claras para que Mariano haga el test manual:

1. Ir a un agente en el dashboard (ej: FAMA - Web).
2. Entrar a la sección Knowledge.
3. Crear una entry de prueba nueva (`category: test`, contenido `"entry de prueba para validación del fix"`).
4. Click en el delete de esa entry de prueba → confirmar que aparece modal.
5. Click en Cancelar → entry sigue en la lista.
6. Click en delete de nuevo + Eliminar → entry desaparece.
7. Refrescar la página → entry sigue sin aparecer (delete real se ejecutó).

## Rollback

Cambios son puramente de UI, aislados en el dashboard. No hay migraciones, no hay cambios de API, no hay state compartido afectado.

Rollback = `git revert <commit>`.

## Fuera de scope (explícito, no expandir)

- No cambiar el comportamiento del endpoint DELETE del backend.
- No agregar soft-delete (feature, no bugfix).
- No agregar undo toast (nice-to-have, siguiente iteración).
- No tocar delete de prompts, tools, agents, sessions, channels — solo knowledge.
- No refactorizar el servicio de knowledge ni el store.
- No agregar confirmación a acciones no destructivas.

## Entrega

Al terminar:

1. **No hacer commit ni push.** Dejar los cambios en el working tree para review.
2. Pegar en el chat un resumen:
   - Archivos modificados/creados.
   - Si se creó ConfirmDialog reusable o no.
   - Output de `pnpm typecheck` y `pnpm build`.
   - Instrucciones de test manual (copiar de la sección Validación manual).
3. Esperar review antes de cualquier commit.

---

**Autor del plan:** Mariano (via Claude Opus 4.7)
**Modelo recomendado para ejecutar:** Claude Sonnet 4.6 (escalar a Opus si aparece un bug no trivial)
**Modo:** `--dangerously-skip-permissions` ok — scope del plan es acotado y los comandos de validación son read-only.