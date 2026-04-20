# Scrape Webpage Tool

## Overview

Herramienta basada en Puppeteer (headless Chrome) que permite al agente manager scrapear paginas web con JS rendering completo. Incluye proteccion SSRF, selectores CSS, screenshots, y extraccion de links.

## Ubicacion

- Tool: `src/tools/definitions/scrape-webpage.ts`
- Registrado en index.ts como `createScrapeWebpageTool`

## Schema de entrada

```typescript
{
  url: string (URL valida, requerido)
  selector?: string        // CSS selector para extraer seccion especifica (ej: ".product-list", "#prices")
  waitForSelector?: string // CSS selector a esperar antes de extraer (para SPAs con carga dinamica)
  extractLinks?: boolean   // incluir links encontrados (default: false)
  screenshot?: boolean     // capturar screenshot PNG base64 (default: false)
}
```

## Schema de salida

```typescript
{
  url: string
  title?: string
  metaDescription?: string
  content: string           // texto extraido (max 15,000 chars)
  contentLength: number
  truncated: boolean        // true si se corto
  links?: Array<{ text: string, href: string }>
  screenshotBase64?: string // PNG en base64
}
```

## Proteccion SSRF

El tool incluye validacion de URLs para prevenir Server-Side Request Forgery:

- **Bloquea IPs privadas**: 10.x.x.x, 172.16-31.x.x, 192.168.x.x, 127.x.x.x
- **Bloquea metadata endpoints**: 169.254.169.254 (AWS/GCP metadata)
- **Bloquea protocolos**: solo permite http:// y https://
- **Resolucion DNS**: verifica que el hostname no resuelva a IP privada

## Caracteristicas

### JS Rendering
Usa Puppeteer con Chromium headless. Renderiza JavaScript completo, ideal para SPAs (React, Angular, Vue).

### CSS Selectors
- `selector`: extrae solo el contenido dentro del elemento seleccionado
- `waitForSelector`: espera hasta que un elemento aparezca en el DOM (timeout configurable)

### Screenshots
- Captura viewport completo como PNG
- Retorna como base64 para incluir en respuestas del agente
- Util para monitoreo visual de competencia, landing pages, etc.

### Limites
- Timeout: 30 segundos por pagina
- Contenido maximo: 15,000 caracteres de texto extraido
- Si el contenido excede el limite, se trunca y `truncated: true`

## Propiedades del Tool

- **Category**: web (implicita)
- **Risk Level**: medium
- **Side Effects**: false (solo lectura)
- **Supports Dry Run**: true
- **Requires Approval**: false

## Casos de uso

### Manager Agent
- Monitoreo de competidores (precios, productos)
- Verificacion de landing pages del proyecto
- Extraccion de datos publicos para reportes

### Agente de licitaciones
- Lectura de paginas de portales que no tienen API
- Complemento a las herramientas MCP de licitaciones

### Agente de investigacion
- Web research para content creation
- Extraccion de datos de directorios publicos
