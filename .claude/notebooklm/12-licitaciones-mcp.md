# Integracion MCP - Licitaciones Publicas Argentinas

## Overview

Servidor MCP externo (Python, FastMCP) que expone herramientas de scraping de portales de licitaciones publicas argentinas. Se conecta a Nexus Core como servidor MCP via SSE.

## Ubicacion

- Repositorio externo: `C:\Users\Mariano\Documents\api_licitaciones\`
- Archivo principal: `mcp_server.py`
- Transporte: stdio (Claude Desktop) o SSE/HTTP (VPS remoto)
- URL tipica en VPS: `http://vps:8001/sse`

## Jurisdicciones soportadas

| Jurisdiccion | ID | Portal |
|-------------|-----|--------|
| Buenos Aires Ciudad | `caba` | Buenos Aires Compras |
| Nacion | `nacion` | Comprar.ar |
| Provincia Buenos Aires | `pba` | PBAC |

## Herramientas MCP disponibles (6)

### 1. list_upcoming_tenders(jurisdiction)
Lista licitaciones con apertura proxima descargando el Excel oficial del portal.
- Input: jurisdiction ("caba", "nacion", "pba")
- Output: lista de procesos con process_id, title, organismo, tipo_proceso, estado, fecha_apertura, monto

### 2. get_tender_details(jurisdiction, process_id, extract_pdf?)
Scrapea el portal oficial para obtener metadata completa de un proceso.
- Input: jurisdiction ("caba" o "nacion"), process_id, extract_pdf (default false)
- Output: basic_info, products (renglones), cronograma, guarantees, documents, available_files, circulares, dictamenes
- Si extract_pdf=true: descarga y extrae texto de PDFs (lento, ~60s)

### 3. download_document(jurisdiction, process_id, file_id, format?)
Descarga y extrae contenido de un documento especifico.
- file_ids CABA: pliego_particular, pliego_tecnico, acto_administrativo-N, circular-N, dictamen-N
- file_ids Nacion: doc-N
- format: "text" (default, extrae texto) o "images" (paginas como base64, para PDFs escaneados)

### 4. search_tenders(q?, jurisdiction?, estado?, tipo_proceso?, organismo?, rubro?, limit?, offset?)
Busca en el catalogo de Supabase (datos previamente ingestados).
- Filtros combinables: texto libre, jurisdiccion, estado, tipo, organismo, rubro
- Paginacion con limit/offset (max 100)
- Ordenado por updated_at desc

### 5. get_tender_from_catalog(jurisdiction, process_id)
Obtiene registro completo desde Supabase sin scrapear (mas rapido pero puede estar desactualizado).
- Incluye raw_data (ultimo scraping) y raw_excel_data (datos de importacion)

### 6. get_process_lifecycle(jurisdiction)
Retorna las etapas del ciclo de vida de un proceso licitatorio.
- stages con label, description, sections, document_types, next_stages
- stage_map: mapeo de nombre crudo del portal a stage normalizado
- process_types: tipos de proceso soportados

## Como conectar a Nexus Core

### 1. Registrar MCP Server en el proyecto
Via API o dashboard, crear una entrada MCP server:
```json
{
  "name": "Licitaciones Argentina",
  "transport": "sse",
  "url": "http://vps-ip:8001/sse",
  "description": "Scraping de licitaciones publicas argentinas (CABA, Nacion, PBA)"
}
```

### 2. Las herramientas se auto-descubren
El MCP client de Nexus Core (`src/mcp/mcp-client.ts`) conecta al servidor SSE, descubre las 6 herramientas y las registra como ExecutableTool via `mcp-tool-adapter.ts`.

### 3. Asignar al agente
En la configuracion del agente, agregar las herramientas MCP descubiertas a su whitelist.

## Arquitectura del agente de licitaciones

### Conocimiento que necesita el agente

1. **Skill Template** (oficial: `official-licitaciones`):
   - Flujo de analisis: listar -> detallar -> descargar pliegos -> extraer requisitos
   - Vocabulario del dominio (pliego, renglon, garantia, OCA, circular)
   - Reglas de cuando usar text vs images para PDFs escaneados

2. **Knowledge Base** (por proyecto):
   - Perfil de la empresa: rubros, montos historicos, zonas
   - Criterios de evaluacion de oportunidades del cliente
   - Historial de licitaciones presentadas

3. **Prompt Layers**:
   - Identity: "Soy un analista de licitaciones publicas argentinas..."
   - Instructions: priorizar analisis de requisitos, alertar vencimientos, recomendar oportunidades
   - Safety: nunca inventar datos de pliegos, siempre citar fuente

### Flujo tipico del agente

1. Buscar oportunidades relevantes: `search_tenders` o `list_upcoming_tenders`
2. Analizar proceso: `get_tender_details` para metadata + cronograma
3. Leer documentos: `download_document` para pliegos y requisitos
4. Evaluar oportunidad: cruzar con perfil del cliente (knowledge base)
5. Reportar: enviar resumen con recomendacion al usuario

## Dependencias externas

- **Supabase**: Base de datos del catalogo de licitaciones (tabla `tenders`)
- **Playwright**: Scraping de los portales oficiales (JS rendering)
- **Python 3.11+**: Runtime del MCP server
- **FastMCP**: Framework MCP para Python
