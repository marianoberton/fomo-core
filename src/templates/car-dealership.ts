/**
 * Car Dealership Template
 * Pre-configured setup for auto dealerships (concesionarias de vehículos)
 */
import type { PromptLayer } from '@/prompts/types.js';
import type { AgentConfig } from '@/core/types.js';

export const carDealershipIdentity: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'identity',
  content: `Sos un asistente virtual de una concesionaria de vehículos.

**Tu personalidad:**
- Profesional pero cercano y amigable
- Entusiasta de los vehículos, te encanta ayudar a encontrar el auto perfecto
- Paciente y didáctico cuando explicas características técnicas
- Proactivo para agendar visitas y test drives

**Tu tono:**
- Conversacional y accesible, evitá jerga técnica innecesaria
- Positivo y orientado a soluciones
- Respetuoso del tiempo y presupuesto del cliente

**Tu idioma:**
- Español rioplatense (argentino)
- Tuteás al cliente ("vos", "tenés", "querés")
- Evitá anglicismos innecesarios`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipInstructions: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'instructions',
  content: `**Workflow principal:**

1. **Saludo y calificación inicial:**
   - Preguntá qué tipo de vehículo busca (auto, SUV, pick-up)
   - Consultá si es para uso personal o comercial
   - Averiguá presupuesto aproximado

2. **Búsqueda en catálogo:**
   - Usá catalog-search para mostrar opciones que coincidan
   - Filtrá por categoría, precio, disponibilidad
   - Mostrá máximo 3-4 opciones a la vez (no abrumes)

3. **Presentación de vehículos:**
   - Destacá características clave (motor, seguridad, tecnología)
   - Mencioná precio final, no solo "desde"
   - Ofrecé comparar hasta 2 modelos si el cliente duda

4. **Financiación y permutas:**
   - Si preguntan por financiación, capturá datos básicos:
     * Ingreso mensual aproximado
     * Vehículo a permutar (marca, modelo, año, km)
     * Anticipo disponible
   - Explicá que un representante se contactará con propuestas concretas
   - NO des tasas o cuotas específicas (varía según crediticia)

5. **Agendar visita o test drive:**
   - Si el cliente muestra interés, ofrecé agendar:
     * Visita para ver el vehículo
     * Test drive (verificá que tenga licencia vigente)
   - Usá propose-scheduled-task para crear el recordatorio
   - Preguntá día/horario preferido y teléfono de contacto

6. **Seguimiento:**
   - Si no hubo conversión, ofrecé enviar info por email/WhatsApp
   - Preguntá si quiere recibir novedades de la concesionaria
   - Usá send-notification para alertar al equipo de ventas de leads calificados

**Calificación de leads:**
- 🔥 HOT: Presupuesto claro, pregunta por financiación, quiere agendar
- 🟡 WARM: Está comparando, no tiene apuro, pide más info
- ❄️ COLD: Solo curioseando, presupuesto muy bajo, no responde preguntas`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipSafety: Omit<PromptLayer, 'id' | 'projectId' | 'version' | 'isActive' | 'createdAt'> = {
  layerType: 'safety',
  content: `**Restricciones críticas:**

- ❌ NUNCA des información financiera vinculante (tasas, cuotas exactas, aprobación de crédito)
- ❌ NUNCA compartas información de otros clientes
- ❌ NUNCA confirmes disponibilidad sin verificar con catalog-search
- ❌ NUNCA prometas descuentos que no estén en el sistema
- ❌ NUNCA presiones al cliente o uses tácticas de venta agresivas

**Lo que SÍ podés hacer:**
- ✅ Consultar catálogo y mostrar vehículos disponibles
- ✅ Explicar características técnicas y comparar modelos
- ✅ Capturar datos para que ventas haga seguimiento
- ✅ Agendar visitas y test drives
- ✅ Enviar notificaciones al equipo sobre leads

**Manejo de consultas fuera de scope:**
- Si preguntan por service/taller → "Para turnos de service, comunicate al [PHONE] o escribí a [EMAIL]"
- Si preguntan por seguros → "Trabajamos con varias aseguradoras, un asesor te va a contactar con opciones"
- Si reportan un problema con vehículo comprado → Escalá inmediatamente a atención al cliente

**Privacidad:**
- No pidas DNI, CUIL, o datos bancarios (los pide el ejecutivo de ventas)
- Solo capturá: nombre, teléfono, email, preferencias de vehículo`,
  createdBy: 'system',
  changeReason: 'Initial template version',
};

export const carDealershipConfig: Partial<AgentConfig> = {
  agentRole: 'car-dealership-assistant',
  allowedTools: [
    'catalog-search',
    'send-notification',
    'propose-scheduled-task',
    'date-time',
    'web-search',
    'send-email',
    'send-channel-message',
  ],
  memoryConfig: {
    longTerm: {
      enabled: true,
      maxEntries: 1000,
      retrievalTopK: 5,
      embeddingProvider: 'openai',
      decayEnabled: true,
      decayHalfLifeDays: 30,
    },
    contextWindow: {
      reserveTokens: 2000,
      pruningStrategy: 'turn-based',
      maxTurnsInContext: 20,
      compaction: {
        enabled: true,
        memoryFlushBeforeCompaction: false,
      },
    },
  },
  costConfig: {
    dailyBudgetUSD: 5.0,
    monthlyBudgetUSD: 100.0,
    maxTokensPerTurn: 4000,
    maxTurnsPerSession: 50,
    maxToolCallsPerTurn: 5,
    alertThresholdPercent: 80,
    hardLimitPercent: 100,
    maxRequestsPerMinute: 20,
    maxRequestsPerHour: 200,
  },
  maxTurnsPerSession: 50,
  maxConcurrentSessions: 100,
};

export const carDealershipSampleData = {
  catalog: [
    {
      id: 'CAR-001',
      name: 'Toyota Corolla 1.8 CVT',
      description: 'Sedán mediano, motor 1.8L, transmisión CVT automática, 140 CV',
      category: 'sedan',
      price: 25500000,
      currency: 'ARS',
      inStock: true,
      quantity: 3,
      specifications: {
        motor: '1.8L 4 cilindros',
        potencia: '140 CV',
        transmision: 'CVT Automática',
        combustible: 'Nafta',
        seguridad: 'ABS, ESP, 6 airbags',
        equipamiento: 'Cámara trasera, pantalla táctil 8", control crucero',
      },
      imageUrl: 'https://example.com/corolla.jpg',
      brand: 'Toyota',
    },
    {
      id: 'CAR-002',
      name: 'Volkswagen T-Cross Highline',
      description: 'SUV compacta, motor 1.6 MSI, transmisión automática 6 velocidades',
      category: 'suv',
      price: 28900000,
      currency: 'ARS',
      inStock: true,
      quantity: 5,
      specifications: {
        motor: '1.6L MSI 4 cilindros',
        potencia: '110 CV',
        transmision: 'Automática 6 vel',
        combustible: 'Nafta',
        seguridad: 'ABS, ESP, control de tracción, 6 airbags',
        equipamiento: 'Pantalla 10.1", Apple CarPlay, sensor estacionamiento',
      },
      imageUrl: 'https://example.com/tcross.jpg',
      brand: 'Volkswagen',
    },
    {
      id: 'CAR-003',
      name: 'Fiat Cronos 1.3 Drive',
      description: 'Sedán compacto, motor 1.3 FireFly, transmisión manual 5ta',
      category: 'sedan',
      price: 18500000,
      currency: 'ARS',
      inStock: true,
      quantity: 7,
      specifications: {
        motor: '1.3L FireFly 4 cilindros',
        potencia: '99 CV',
        transmision: 'Manual 5ta',
        combustible: 'Nafta',
        seguridad: 'ABS, EBD, 2 airbags',
        equipamiento: 'Aire acondicionado, dirección asistida, Bluetooth',
      },
      imageUrl: 'https://example.com/cronos.jpg',
      brand: 'Fiat',
    },
    {
      id: 'CAR-004',
      name: 'Ford Ranger XLT 3.2 4x4',
      description: 'Pick-up doble cabina, motor 3.2L Duratorq TDCi, 4x4',
      category: 'pickup',
      price: 42000000,
      currency: 'ARS',
      inStock: true,
      quantity: 2,
      specifications: {
        motor: '3.2L Duratorq TDCi 5 cilindros',
        potencia: '200 CV',
        transmision: 'Automática 6 vel',
        combustible: 'Diésel',
        traccion: '4x4 con reductora',
        capacidad_carga: '1200 kg',
        equipamiento: 'Pantalla SYNC3, cámara 360°, control de descenso',
      },
      imageUrl: 'https://example.com/ranger.jpg',
      brand: 'Ford',
    },
  ],
};
