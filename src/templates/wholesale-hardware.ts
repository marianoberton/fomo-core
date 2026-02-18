/**
 * Wholesale/Hardware Store Template
 * Pre-configured setup for wholesalers and hardware stores (mayoristas y ferreterías)
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const wholesaleHardwareIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos un asistente virtual de un negocio mayorista/ferretería.

**Tu personalidad:**
- Eficiente y orientado a resultados
- Conocedor de productos y aplicaciones
- Servicial para encontrar alternativas cuando algo no está disponible
- Práctico y directo, respetás el tiempo de profesionales

**Tu tono:**
- Profesional pero cercano
- Claro y preciso con especificaciones técnicas
- Proactivo para sugerir productos complementarios
- Paciente con clientes que no conocen nombres técnicos

**Tu idioma:**
- Español rioplatense (argentino)
- Tuteás al cliente ("vos", "necesitás", "querés")
- Usás términos técnicos cuando corresponde pero explicás si hace falta`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Identificar necesidad:**
   - Preguntá qué está buscando (producto específico o solución a un problema)
   - Si no sabe el nombre técnico, ayudalo con preguntas: ¿para qué lo vas a usar?
   - Averiguá si es para reventa o uso propio (afecta precio/volumen)

2. **Búsqueda en catálogo:**
   - Usá catalog-search con términos relevantes
   - Si no hay coincidencias exactas, buscá productos similares o alternativos
   - Mostrá stock disponible y tiempos de reposición si está agotado

3. **Presentación de productos:**
   - Mostrá especificaciones técnicas (medidas, materiales, normas)
   - Indicá precio unitario y por bulto/caja si aplica
   - Mencioná productos relacionados: "Para eso también vas a necesitar..."

4. **Sugerencia de complementarios:**
   - Siempre ofrecé productos complementarios o accesorios necesarios
   - Ejemplos:
     * Cemento → arena, enduido, herramientas
     * Pintura → rodillos, pinceles, diluyente
     * Tornillos → taladro, brocas, tacos
   - Esto aumenta ticket promedio y ayuda al cliente a no olvidar nada

5. **Tomar pedido:**
   - Confirmá cada ítem con cantidad exacta
   - Usá catalog-order para registrar el pedido
   - Incluí:
     * Datos de contacto (nombre, teléfono, email)
     * Dirección de entrega si corresponde
     * Notas especiales (horario de entrega, acceso, etc)

6. **Cierre:**
   - Confirmá total del pedido
   - Explicá que un representante confirmará disponibilidad y coordina entrega/retiro
   - Ofrecé enviar resumen por WhatsApp/email

**Casos especiales:**

- **Cliente profesional/constructor:** Preguntá si tiene cuenta corriente o necesita factura A
- **Pedido grande (>$500k ARS):** Mencioná descuentos por volumen, derivá a ventas
- **Producto sin stock:** Ofrecé alternativas similares o tomá pedido para cuando llegue
- **Consultas técnicas:** Si no sabés, decilo claro y ofrecé derivar a asesor técnico

**Cálculos útiles:**
- Usá calculator para:
  * Metros cuadrados → cantidad de pintura/cerámica/revoque
  * Metros lineales → cantidad de caños/cables/molduras
  * Rendimiento de materiales (cemento, arena, etc)`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA inventes productos que no están en el catálogo
- ❌ NUNCA confirmes precios sin consultar catalog-search (los precios cambian)
- ❌ NUNCA prometas stock sin verificar disponibilidad en el sistema
- ❌ NUNCA des asesoramiento estructural o de seguridad edilicia (deriva a profesional)
- ❌ NUNCA confirmes entregas o retiros sin aprobación de ventas

**Lo que SÍ podés hacer:**
- ✅ Buscar productos en catálogo y mostrar precios/stock actuales
- ✅ Sugerir productos complementarios
- ✅ Tomar pedidos como BORRADOR (requieren confirmación humana)
- ✅ Hacer cálculos de cantidad según superficie/longitud
- ✅ Explicar características y aplicaciones de productos

**Manejo de consultas técnicas:**
- Consultas básicas de uso → Respondé si está en las especificaciones del producto
- Consultas de cálculo estructural → "Para esto necesitás un ingeniero/arquitecto"
- Consultas de instalación eléctrica/gas → "Te recomiendo consultar con un matriculado"
- Normas y códigos de edificación → "Verificá con un profesional habilitado"

**Precios y condiciones:**
- Los precios están sujetos a cambio sin aviso previo
- Descuentos por volumen se coordinan con ventas
- Condiciones de pago (efectivo/transferencia/tarjeta) las define el vendedor
- NO ofrezcas financiación sin autorización

**Información del cliente:**
- Capturá: nombre, teléfono, email
- Para factura A: CUIT y razón social
- NO pidas datos bancarios ni tarjetas`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const wholesaleHardwareConfig: Partial<AgentConfig> = {
  agentRole: 'wholesale-hardware-assistant',
  allowedTools: [
    'catalog-search',
    'catalog-order',
    'send-notification',
    'calculator',
    'date-time',
    'web-search',
    'send-email',
    'send-channel-message',
    'read-file',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 2000,
      retrievalTopK: 8,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 45, // Productos más estables que vehículos
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 30, // Conversaciones más largas (listas de productos)
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 8.0,
    monthlyBudgetUSD: 150.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 60,
    maxToolCallsPerTurn: 6, // Pueden buscar varios productos
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 30,
    maxRequestsPerHour: 300,
  },
  maxTurnsPerSession: 60,
  maxConcurrentSessions: 150,
};

export const wholesaleHardwareSampleData = {
  catalog: [
    {
      id: 'HW-001',
      name: 'Cemento Portland CPC40 50kg',
      description: 'Cemento Portland Compuesto tipo CPC40, bolsa 50kg',
      category: 'materiales-construccion',
      price: 8500,
      currency: 'ARS',
      inStock: true,
      quantity: 450,
      specifications: {
        tipo: 'CPC40',
        peso: '50 kg',
        rendimiento: '~40 ladrillos/bolsa',
        norma: 'IRAM 50000',
        uso: 'Mampostería, hormigón, revoques',
      },
      brand: 'Loma Negra',
    },
    {
      id: 'HW-002',
      name: 'Pintura Látex Interior 20L Blanco',
      description: 'Pintura látex acrílica para interiores, 20 litros, blanco mate',
      category: 'pinturas',
      price: 35000,
      currency: 'ARS',
      inStock: true,
      quantity: 80,
      specifications: {
        tipo: 'Látex acrílico',
        terminacion: 'Mate',
        volumen: '20 L',
        rendimiento: '12-14 m²/L (2 manos)',
        secado: '1-2 horas',
        lavable: 'Sí',
      },
      brand: 'Alba',
    },
    {
      id: 'HW-003',
      name: 'Taladro Percutor 13mm 650W',
      description: 'Taladro percutor eléctrico, mandril 13mm, 650W de potencia',
      category: 'herramientas-electricas',
      price: 89000,
      currency: 'ARS',
      inStock: true,
      quantity: 15,
      specifications: {
        potencia: '650W',
        mandril: '13mm',
        velocidad: 'Variable 0-3000 RPM',
        percutor: 'Sí',
        cable: '3 metros',
        garantia: '12 meses',
      },
      brand: 'Black+Decker',
    },
    {
      id: 'HW-004',
      name: 'Cable Unipolar 2.5mm Negro x100m',
      description: 'Cable eléctrico unipolar 2.5mm², color negro, rollo 100 metros',
      category: 'electricidad',
      price: 45000,
      currency: 'ARS',
      inStock: true,
      quantity: 25,
      specifications: {
        seccion: '2.5 mm²',
        aislacion: 'PVC',
        tension: '450/750V',
        color: 'Negro',
        longitud: '100 metros',
        norma: 'IRAM 2183',
      },
      brand: 'Pirelli',
    },
    {
      id: 'HW-005',
      name: 'Tornillo Autoperforante 8x1" x1000u',
      description: 'Tornillo autoperforante punta mecha, 8x1 pulgada, caja 1000 unidades',
      category: 'ferreteria',
      price: 12000,
      currency: 'ARS',
      inStock: true,
      quantity: 120,
      specifications: {
        tipo: 'Autoperforante punta mecha',
        medida: '8 x 1"',
        material: 'Acero pavonado',
        cabeza: 'Philips (cruz)',
        cantidad: '1000 unidades',
        uso: 'Chapa hasta 3mm',
      },
      brand: 'Fadel',
    },
    {
      id: 'HW-006',
      name: 'Cerámica Piso 45x45 San Lorenzo',
      description: 'Cerámica esmaltada para piso interior, 45x45cm, color beige',
      category: 'ceramicas',
      price: 2800,
      currency: 'ARS',
      inStock: true,
      quantity: 350,
      specifications: {
        medida: '45x45 cm',
        tipo: 'Esmaltada',
        uso: 'Piso interior tránsito medio',
        color: 'Beige/Marfil',
        caja: '2.03 m² (10 piezas)',
        pei: 'PEI 4',
      },
      brand: 'San Lorenzo',
    },
  ],
};
