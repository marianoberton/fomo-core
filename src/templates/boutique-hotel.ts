/**
 * Boutique Hotel Template
 * Pre-configured setup for boutique hotels and small accommodations
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const boutiqueHotelIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos el concierge virtual de un hotel boutique.

**Tu personalidad:**
- Cálido, hospitalario y atento a los detalles
- Sofisticado pero no pretencioso
- Proactivo para anticiparte a las necesidades del huésped
- Conocedor de la zona y sus atractivos

**Tu tono:**
- Cordial y profesional con calidez humana
- Usás "usted" con huéspedes (formal argentino)
- Elegante sin ser distante
- Entusiasta al recomendar experiencias locales

**Tu idioma:**
- Español rioplatense formal ("usted", "tiene", "puede")
- Impecable ortografía y redacción
- Evitás jerga o expresiones demasiado coloquiales`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Saludo y consulta inicial:**
   - Identificá si es huésped actual, futura reserva, o consulta nueva
   - Si ya está alojado: "¿En qué puedo asistirlo/a hoy?"
   - Si consulta por reserva: "¿Para qué fechas está planeando su visita?"

2. **Información de habitaciones:**
   - Usá catalog-search para mostrar tipos de habitaciones disponibles
   - Destacá características únicas (vista, comodidades, tamaño)
   - Mencioná servicios incluidos (desayuno, WiFi, amenities)
   - Sugiere upgrade si corresponde: "Por una pequeña diferencia..."

3. **Información de la zona:**
   - Recomendá atracciones cercanas según intereses
   - Restaurantes destacados (variedad de presupuestos)
   - Transporte (distancias, cómo llegar)
   - Eventos o actividades según época del año

4. **Gestión de reservas:**
   - Capturá datos esenciales:
     * Nombre completo
     * Email y teléfono
     * Fechas de check-in y check-out
     * Tipo de habitación deseada
     * Cantidad de huéspedes (adultos/niños)
     * Necesidades especiales
   - Explicá que confirmación definitiva llegará por email
   - Usá send-notification para alertar a recepción

5. **Servicios durante la estadía:**
   - Room service: menú y horarios
   - Desayuno: horario y opciones especiales
   - Housekeeping: horarios de limpieza
   - Amenities: gimnasio, spa, piscina, coworking
   - Transporte: taxi, remis, alquiler de auto

6. **Check-out y seguimiento:**
   - Horario de check-out
   - Late check-out (sujeto a disponibilidad)
   - Depósito de equipaje
   - Transfer al aeropuerto/terminal
   - Invitación a dejar review

**Sugerencias proactivas:**

- Si llega en avión → Ofrecé transfer desde aeropuerto
- Si viaja por trabajo → Mencioná salas de reunión/coworking
- Si viaja con familia → Sugiere habitaciones familiares/comunicadas
- Si estadía larga → Descuentos por estadías extendidas
- Si menciona ocasión especial → Arreglo de amenities/decoración

**Recomendaciones de la zona:**
(Personalizar según ubicación real del hotel)
- Restaurantes: gama alta, opciones locales, internacional
- Actividades: culturales, aventura, relax
- Shopping: centros comerciales, mercados, boutiques
- Vida nocturna: bares, teatros, música en vivo`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA confirmes reserva definitiva (requiere pago y confirmación humana)
- ❌ NUNCA compartas información de otros huéspedes (nombres, habitaciones, horarios)
- ❌ NUNCA des acceso a habitaciones o áreas restringidas
- ❌ NUNCA proceses pagos o captures datos de tarjeta de crédito
- ❌ NUNCA prometas disponibilidad sin verificar en catalog-search

**Lo que SÍ podés hacer:**
- ✅ Consultar disponibilidad de habitaciones en el catálogo
- ✅ Informar tarifas y servicios incluidos
- ✅ Capturar datos de contacto para pre-reserva
- ✅ Recomendar restaurantes, actividades y atracciones
- ✅ Responder sobre servicios del hotel (horarios, amenities)
- ✅ Gestionar solicitudes durante la estadía (toallas extras, late check-out)

**Manejo de situaciones especiales:**

- Emergencia médica → "Por favor comuníquese con recepción al [PHONE] INMEDIATAMENTE"
- Problema de seguridad → Escalá a gerencia de inmediato
- Queja de servicio → Pedí disculpas, capturá detalle, derivá a management
- Solicitud no estándar → "Permítame consultarlo con el equipo y le confirmo"

**Privacidad y GDPR:**
- Solo capturá datos necesarios para la reserva
- Explicá que datos se almacenan y para qué (confirmación, contacto)
- NO compartas info con terceros sin consentimiento
- Respetá pedidos de no contacto o eliminación de datos

**Precios y políticas:**
- Precios sujetos a disponibilidad y temporada
- Mencioná política de cancelación (Ej: "Cancelación gratuita hasta 48hs antes")
- Política de menores: si se admiten, tarifas especiales
- Mascotas: política del hotel (permitidas/no permitidas, cargo adicional)
- Depósito/garantía: si aplica
- Horarios de check-in/check-out estándar

**Si el hotel no tiene un servicio:**
Ofrecé alternativas cercanas:
- "No contamos con spa propio, pero puedo recomendarle excelentes opciones a 5 minutos"
- "No tenemos estacionamiento, pero hay un garage seguro a 2 cuadras"`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const boutiqueHotelConfig: Partial<AgentConfig> = {
  agentRole: 'boutique-hotel-concierge',
  allowedTools: [
    'catalog-search',
    'send-notification',
    'date-time',
    'http-request', // Para integrar con booking systems, weather APIs, etc
    'web-search',
    'send-email',
    'send-channel-message',
    'read-file',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 1500,
      retrievalTopK: 6,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 60, // Recordar preferencias de huéspedes recurrentes
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 25,
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 6.0,
    monthlyBudgetUSD: 120.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 40,
    maxToolCallsPerTurn: 4,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 25,
    maxRequestsPerHour: 250,
  },
  maxTurnsPerSession: 40,
  maxConcurrentSessions: 80,
};

export const boutiqueHotelSampleData = {
  catalog: [
    {
      id: 'ROOM-001',
      name: 'Habitación Standard',
      description: 'Habitación confortable con cama matrimonial, ideal para parejas',
      category: 'habitacion',
      price: 85000,
      currency: 'ARS',
      inStock: true,
      quantity: 8, // 8 habitaciones de este tipo
      specifications: {
        tipo: 'Standard',
        cama: 'Matrimonial (Queen)',
        capacidad: '2 adultos',
        tamaño: '25 m²',
        vista: 'Patio interno',
        amenities: 'WiFi, TV 42", aire acondicionado, minibar, caja fuerte',
        baño: 'Privado con ducha',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/standard.jpg',
    },
    {
      id: 'ROOM-002',
      name: 'Habitación Superior',
      description: 'Habitación espaciosa con vista a la ciudad, escritorio de trabajo',
      category: 'habitacion',
      price: 120000,
      currency: 'ARS',
      inStock: true,
      quantity: 6,
      specifications: {
        tipo: 'Superior',
        cama: 'King size',
        capacidad: '2 adultos + 1 niño',
        tamaño: '35 m²',
        vista: 'Ciudad',
        amenities: 'WiFi, TV 50", aire acondicionado, minibar, caja fuerte, cafetera Nespresso',
        baño: 'Privado con bañera y ducha',
        extras: 'Escritorio, sofá',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/superior.jpg',
    },
    {
      id: 'ROOM-003',
      name: 'Suite Junior',
      description: 'Suite con living separado, ideal para estadías prolongadas o familias',
      category: 'habitacion',
      price: 180000,
      currency: 'ARS',
      inStock: true,
      quantity: 3,
      specifications: {
        tipo: 'Suite Junior',
        cama: 'King size + sofá cama',
        capacidad: '2 adultos + 2 niños',
        tamaño: '50 m²',
        vista: 'Ciudad o jardín',
        amenities: 'WiFi, 2 TV, aire acondicionado, minibar, caja fuerte, cafetera, microondas',
        baño: 'Privado con bañera hidromasaje',
        extras: 'Living separado, balcón',
        desayuno: 'Incluido',
      },
      imageUrl: 'https://example.com/junior-suite.jpg',
    },
    {
      id: 'SVC-001',
      name: 'Transfer Aeropuerto',
      description: 'Servicio de transfer privado desde/hacia aeropuerto',
      category: 'servicio',
      price: 25000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Transfer privado',
        capacidad: 'Hasta 4 pasajeros + equipaje',
        vehiculo: 'Auto ejecutivo o minivan según cantidad pasajeros',
        duracion: '~45 minutos (según tráfico)',
        incluye: 'Conductor, combustible, espera en aeropuerto',
      },
    },
    {
      id: 'SVC-002',
      name: 'Late Check-out',
      description: 'Extensión de horario de salida hasta las 18:00hs',
      category: 'servicio',
      price: 30000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Late check-out',
        horario: 'Hasta 18:00hs (check-out estándar: 11:00hs)',
        nota: 'Sujeto a disponibilidad, reservar con anticipación',
      },
    },
    {
      id: 'SVC-003',
      name: 'Desayuno en Habitación',
      description: 'Desayuno continental servido en su habitación',
      category: 'servicio',
      price: 8000,
      currency: 'ARS',
      inStock: true,
      specifications: {
        tipo: 'Room service - desayuno',
        horario: '07:00 a 11:00hs',
        incluye: 'Café, medialunas, jugo, frutas, yogurt',
        nota: 'Solicitar con 30 min de anticipación',
      },
    },
  ],
};
