/**
 * Seed: 10 research verticals with full scoringRubric + analysisInstructions.
 *
 * Idempotent via `slug` UNIQUE + `skipDuplicates: true`.
 * All weights within each rubric sum to 1.0.
 *
 * Source: NEXUS_INTELLIGENCE_PLAN.md §1.1.
 * Owner: Claude #2 (Targets + Verticals + Compliance track).
 */
import type { PrismaClient } from '@prisma/client';

const VERTICALS = [
  {
    slug: 'automotriz',
    name: 'Automotriz',
    description: 'Concesionarias, talleres, venta de autos nuevos y usados.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'onboarding', label: 'Bienvenida y orientación', weight: 0.15 },
        { key: 'catalog_navigation', label: 'Navegación de catálogo', weight: 0.20 },
        { key: 'pricing_accuracy', label: 'Precisión de precios y stock', weight: 0.20 },
        { key: 'financing_handling', label: 'Manejo de financiación', weight: 0.15 },
        { key: 'appointment_booking', label: 'Agendamiento de visita/service', weight: 0.15 },
        { key: 'objection_handling', label: 'Manejo de objeciones', weight: 0.15 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para concesionarias automotrices.
Analiza esta conversación con foco en: capacidad de mostrar stock real, manejo de
financiación y tasas, calificación del lead comprador, y agendamiento de test drives.
Detecta si tiene acceso a datos de inventario en tiempo real o responde con datos estáticos.
Evalúa si puede generar urgencia de compra apropiadamente.

Presta atención a:
- ¿Ofrece modelos con disponibilidad real o habla de forma genérica?
- ¿Puede cotizar con tasas vigentes de financiación?
- ¿Agenda turnos en el mismo canal o deriva a otro?
- ¿Responde preguntas técnicas (motorización, versiones) o desvía?
- ¿Detecta si el lead ya tiene un usado para parte de pago?`,
  },

  {
    slug: 'real-estate',
    name: 'Real Estate',
    description: 'Inmobiliarias, desarrolladoras, alquileres y ventas de propiedades.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'onboarding', label: 'Bienvenida y orientación', weight: 0.10 },
        { key: 'property_search', label: 'Búsqueda y filtrado de propiedades', weight: 0.25 },
        { key: 'lead_qualification', label: 'Calificación del comprador/inquilino', weight: 0.20 },
        { key: 'visit_scheduling', label: 'Coordinación de visitas', weight: 0.20 },
        { key: 'financing_info', label: 'Info de créditos hipotecarios', weight: 0.15 },
        { key: 'followup', label: 'Seguimiento post-consulta', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para inmobiliarias.
Analiza con foco en: calificación del interesado (compra/alquiler, presupuesto, zona),
capacidad de mostrar propiedades relevantes, agendamiento de visitas, y manejo de
consultas sobre créditos hipotecarios. Detecta si tiene acceso a portal inmobiliario real.

Presta atención a:
- ¿Filtra propiedades por zona, precio, ambientes y tipo en la misma conversación?
- ¿Puede mandar fotos o links de la propiedad sin salir del chat?
- ¿Califica si el lead es comprador o inquilino y ajusta la conversación?
- ¿Da información de créditos hipotecarios actualizados o solo dice "consultá tu banco"?
- ¿Agenda visitas con nombre del asesor y dirección o lo deriva al teléfono?`,
  },

  {
    slug: 'wholesale',
    name: 'Mayorista',
    description: 'Distribuidoras, importadoras, ventas B2B al por mayor.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'onboarding', label: 'Bienvenida y orientación', weight: 0.10 },
        { key: 'catalog_pricing', label: 'Catálogo y precios por volumen', weight: 0.25 },
        { key: 'order_management', label: 'Gestión de pedidos', weight: 0.25 },
        { key: 'stock_accuracy', label: 'Precisión de stock', weight: 0.20 },
        { key: 'account_management', label: 'Gestión de cuenta cliente', weight: 0.10 },
        { key: 'delivery_info', label: 'Info de entrega y logística', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para distribuidoras y mayoristas.
Analiza con foco en: capacidad de mostrar listas de precios por volumen, verificación de
stock en tiempo real, toma de pedidos, y gestión de cuenta de cliente habitual.
Detecta si puede hacer lookups de historial de compras o saldo de cuenta.

Presta atención a:
- ¿Puede mostrar precios diferenciados por cantidad (escalas de precio)?
- ¿Confirma stock antes de levantar el pedido o da estimados?
- ¿Puede tomar un pedido completo en el chat (producto, cantidad, condición de pago)?
- ¿Reconoce a clientes habituales y accede a su historial?
- ¿Da tiempos de entrega reales por zona o responde con rangos amplios?`,
  },

  {
    slug: 'medicina',
    name: 'Medicina / Salud',
    description: 'Clínicas, consultorios, centros de diagnóstico. Excluye líneas de crisis.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'onboarding', label: 'Bienvenida y orientación', weight: 0.10 },
        { key: 'appointment_booking', label: 'Agendamiento de turnos', weight: 0.30 },
        { key: 'triage', label: 'Triaje y orientación básica', weight: 0.20 },
        { key: 'insurance_handling', label: 'Manejo de obras sociales/seguros', weight: 0.20 },
        { key: 'results_info', label: 'Info sobre resultados y estudios', weight: 0.10 },
        { key: 'empathy', label: 'Tono empático en situaciones sensibles', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para el sector salud (clínicas, consultorios, diagnóstico).
Analiza con foco en: flujo de agendamiento de turnos (especialidad, médico, fecha, horario),
manejo de obras sociales, triaje básico para orientar urgencia, y tono empático.
Detecta señales de acceso a agenda médica real vs respuestas genéricas.

NOTA: Solo analiza agentes de consultorios, clínicas de diagnóstico y turnos médicos.
Las líneas de emergencias y crisis mental están excluidas del programa.

Presta atención a:
- ¿Puede agendar por especialidad y médico específico dentro del chat?
- ¿Verifica cobertura de obra social antes de confirmar turno?
- ¿Orienta adecuadamente según urgencia (¿derivar a guardia o turno programado)?
- ¿Informa sobre preparación para estudios (ayuno, etc.) con precisión?
- ¿Mantiene tono empático ante síntomas preocupantes?`,
  },

  {
    slug: 'hospitality',
    name: 'Hotelería / Turismo',
    description: 'Hoteles, hosterías, agencias de viaje, alquileres turísticos.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'availability_check', label: 'Consulta de disponibilidad', weight: 0.25 },
        { key: 'booking_flow', label: 'Flujo de reserva completo', weight: 0.25 },
        { key: 'upsell', label: 'Upsell de servicios adicionales', weight: 0.15 },
        { key: 'modification_cancellation', label: 'Modificación y cancelación', weight: 0.20 },
        { key: 'local_info', label: 'Info local y recomendaciones', weight: 0.15 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para hotelería y turismo.
Analiza con foco en: consulta de disponibilidad por fechas, flujo completo de reserva,
upsell de servicios extra, manejo de modificaciones y cancelaciones, y calidad de
información turística local.

Presta atención a:
- ¿Verifica disponibilidad en tiempo real por fechas y tipo de habitación?
- ¿Puede completar una reserva incluyendo datos de pago o deriva a la web?
- ¿Ofrece proactivamente habitaciones superiores o servicios extra (desayuno, spa)?
- ¿Explica la política de cancelación con claridad (fechas límite, penalidades)?
- ¿Provee recomendaciones locales (restaurantes, transporte, actividades) con detalle útil?`,
  },

  {
    slug: 'ecommerce',
    name: 'E-commerce / Retail',
    description: 'Tiendas online, marketplaces, retail multicanal.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'order_tracking', label: 'Seguimiento de pedidos', weight: 0.25 },
        { key: 'product_discovery', label: 'Búsqueda de productos', weight: 0.20 },
        { key: 'returns_exchanges', label: 'Devoluciones y cambios', weight: 0.20 },
        { key: 'payment_issues', label: 'Problemas de pago', weight: 0.15 },
        { key: 'promotions', label: 'Información de promociones', weight: 0.10 },
        { key: 'escalation', label: 'Escalación a humano', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para e-commerce.
Analiza con foco en: seguimiento de pedidos en tiempo real, proceso de devoluciones,
manejo de problemas de pago, búsqueda y recomendación de productos, y escalación efectiva.
Detecta si tiene acceso a OMS/ERP real o solo responde con templates.

Presta atención a:
- ¿Puede trackear un pedido con número de orden y dar estado real + fecha estimada?
- ¿Inicia el proceso de devolución o cambio completamente en el chat?
- ¿Puede verificar si un pago fue acreditado o identificar el problema?
- ¿Recomienda productos alternativos cuando hay quiebre de stock?
- ¿Deriva a humano con contexto del problema o reinicia la conversación?`,
  },

  {
    slug: 'legal',
    name: 'Estudios Legales',
    description: 'Estudios de abogados, consultas legales, gestión de casos.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'case_qualification', label: 'Calificación de caso legal', weight: 0.30 },
        { key: 'area_routing', label: 'Derivación por área legal', weight: 0.20 },
        { key: 'consultation_booking', label: 'Agendamiento de consulta', weight: 0.25 },
        { key: 'legal_accuracy', label: 'Precisión de info legal básica', weight: 0.15 },
        { key: 'confidentiality', label: 'Manejo de confidencialidad', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para estudios jurídicos.
Analiza con foco en: calificación del tipo de caso legal, derivación al área correcta
(laboral, civil, familia, penal, etc.), agendamiento de primera consulta, y manejo
apropiado de confidencialidad. Detecta si da asesoramiento real o solo agenda.

Presta atención a:
- ¿Identifica el área del derecho relevante para el caso planteado?
- ¿Hace preguntas de calificación antes de derivar o recomendar?
- ¿Agenda la consulta inicial con datos concretos (fecha, modo, honorarios aproximados)?
- ¿Da información legal básica correcta o solo dice "depende del caso"?
- ¿Trata los datos del cliente con discreción apropiada para el ámbito legal?`,
  },

  {
    slug: 'educacion',
    name: 'Educación',
    description: 'Colegios, universidades, institutos, cursos online.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'program_info', label: 'Información de programas y cursos', weight: 0.25 },
        { key: 'enrollment_flow', label: 'Flujo de inscripción', weight: 0.25 },
        { key: 'requirements', label: 'Requisitos y aranceles', weight: 0.20 },
        { key: 'academic_support', label: 'Soporte académico a alumnos', weight: 0.15 },
        { key: 'lead_nurturing', label: 'Nurturing de prospecto', weight: 0.15 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para instituciones educativas.
Analiza con foco en: información de programas académicos, proceso de inscripción,
requisitos de admisión, aranceles, y capacidad de nutrir un prospecto hasta la inscripción.

Presta atención a:
- ¿Explica la propuesta académica diferenciándola de la competencia?
- ¿Guía paso a paso el proceso de inscripción o derivación web?
- ¿Informa aranceles, becas y condiciones de pago con exactitud?
- ¿Puede responder consultas de alumnos activos (fechas de examen, materias)?
- ¿Hace seguimiento proactivo al prospecto o solo responde cuando preguntan?`,
  },

  {
    slug: 'fintech-cobranzas',
    name: 'Cobranzas / Fintech',
    description: 'Gestión de cobranzas, bancos, fintechs, créditos.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'balance_inquiry', label: 'Consulta de saldo/deuda', weight: 0.25 },
        { key: 'payment_plan', label: 'Propuesta de plan de pago', weight: 0.25 },
        { key: 'dispute_handling', label: 'Manejo de disputas', weight: 0.20 },
        { key: 'payment_link', label: 'Generación de link de pago', weight: 0.15 },
        { key: 'negotiation_tone', label: 'Tono negociador (firme pero empático)', weight: 0.15 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para cobranzas y fintech.
Analiza con foco en: consulta de saldo/deuda en tiempo real, propuesta de planes de pago,
manejo de disputas y rechazos, generación de medios de pago, y equilibrio entre firmeza
y empatía. Detecta si tiene acceso real al sistema de gestión de deuda.

Presta atención a:
- ¿Muestra el saldo de deuda actualizado con fecha de vencimiento y monto exacto?
- ¿Puede proponer un plan de cuotas con tasas y montos concretos?
- ¿Escucha y registra disputas sin ponerse a la defensiva?
- ¿Genera un link de pago validado en el chat o deriva a un portal externo?
- ¿Mantiene profesionalismo cuando el deudor rechaza o insiste en no pagar?`,
  },

  {
    slug: 'servicios-hogar',
    name: 'Servicios del Hogar',
    description: 'Plomería, electricidad, HVAC, limpieza, mantenimiento.',
    isActive: true,
    scoringRubric: {
      dimensions: [
        { key: 'service_qualification', label: 'Calificación del servicio requerido', weight: 0.25 },
        { key: 'availability_booking', label: 'Disponibilidad y agendamiento', weight: 0.30 },
        { key: 'pricing_estimate', label: 'Estimación de precio', weight: 0.20 },
        { key: 'urgency_handling', label: 'Manejo de urgencias', weight: 0.15 },
        { key: 'followup', label: 'Confirmación y seguimiento', weight: 0.10 },
      ],
    },
    analysisInstructions: `Eres un experto en agentes IA para servicios del hogar (plomería, electricidad, limpieza, HVAC, etc.).
Analiza con foco en: calificación del tipo de servicio, agendamiento por zona y disponibilidad,
estimación de precios, y manejo de urgencias.

Presta atención a:
- ¿Hace preguntas que clasifican el servicio (tipo de problema, zona, características del inmueble)?
- ¿Puede dar disponibilidad real con fecha y franja horaria concreta?
- ¿Da estimaciones de precio (rango mínimo/máximo) o dice siempre "depende"?
- ¿Tiene protocolo diferenciado para urgencias (escape de agua, corte de luz)?
- ¿Confirma el turno con datos del técnico asignado y envía recordatorio?`,
  },
] as const;

/**
 * Seed the 10 research verticals.
 * Idempotent — uses `createMany` with `skipDuplicates: true`.
 */
export async function seedResearchVerticals(prisma: PrismaClient): Promise<void> {
  const result = await prisma.researchVertical.createMany({
    data: VERTICALS.map((v) => ({
      slug: v.slug,
      name: v.name,
      description: v.description,
      isActive: v.isActive,
      scoringRubric: v.scoringRubric,
      analysisInstructions: v.analysisInstructions,
    })),
    skipDuplicates: true,
  });

  console.log(`  [research] seedResearchVerticals — ${result.count} verticals upserted (of ${VERTICALS.length})`);
}
