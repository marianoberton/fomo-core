/**
 * Verticals Index
 *
 * Exports all verticals as VerticalConfig — both JSON-defined and TypeScript-defined.
 * This unifies the interface so all consumers work with VerticalConfig objects.
 */

import type { VerticalConfig } from './vertical-config.schema.js';
import { registerVertical } from './vertical-registry.js';

// ─── TypeScript Vertical Adapters ────────────────────────────────

/**
 * Hotels vertical — seasonal pricing, multi-language support.
 */
export const hotelsVerticalConfig: VerticalConfig = {
  id: 'hotels',
  name: 'Hotel / Hospedaje',
  description:
    'Vertical para hoteles, hosterías, cabañas y alojamientos. Incluye precios estacionales y soporte multi-idioma.',
  industry: 'hospitalidad',
  identityFragment:
    'Sos el asistente virtual de {businessName}, un {businessType}. Ayudás a los huéspedes con información sobre habitaciones, precios, disponibilidad y reservas. Respondés en el idioma del huésped de forma natural y profesional.',
  instructionsFragment:
    '## Protocolo de atención - {businessName}\n- Check-in: {checkInTime} | Check-out: {checkOutTime}\n- Temporadas: Alta (diciembre-marzo, julio), Media (marzo-junio, septiembre-noviembre), Baja (agosto)\n- Siempre calculá el precio correcto según temporada antes de informar tarifas\n- Para grupos de más de {maxGroupSize} personas, derivá a reservas@{businessDomain}\n- Política de cancelación: {cancellationPolicy}\n- Detectá el idioma del huésped y respondé siempre en ese idioma',
  tools: [
    {
      toolId: 'hotel-seasonal-pricing',
      displayName: 'Calcular precio por temporada',
      description: 'Calcula el precio de habitaciones según temporada y fechas',
      defaultEnabled: true,
      riskLevel: 'low',
    },
    {
      toolId: 'hotel-detect-language',
      displayName: 'Detectar idioma del huésped',
      description: 'Detecta y mantiene el idioma preferido del huésped',
      defaultEnabled: true,
      riskLevel: 'low',
    },
    {
      toolId: 'contact-update',
      displayName: 'Registrar reserva',
      description: 'Registra datos de reserva del huésped',
      defaultEnabled: true,
      riskLevel: 'medium',
    },
  ],
  parametersSchema: {
    businessName: {
      type: 'string',
      label: 'Nombre del hotel',
      required: true,
    },
    businessType: {
      type: 'enum',
      label: 'Tipo de alojamiento',
      options: ['hotel', 'hostería', 'cabaña', 'apart hotel', 'bed & breakfast', 'hostel'],
      default: 'hotel',
      required: true,
    },
    checkInTime: {
      type: 'string',
      label: 'Hora de check-in',
      default: '14:00',
      required: false,
    },
    checkOutTime: {
      type: 'string',
      label: 'Hora de check-out',
      default: '11:00',
      required: false,
    },
    maxGroupSize: {
      type: 'number',
      label: 'Máximo para reserva online',
      default: 10,
      required: false,
    },
    businessDomain: {
      type: 'string',
      label: 'Dominio del negocio',
      description: 'Para armar el email de contacto',
      required: false,
    },
    cancellationPolicy: {
      type: 'string',
      label: 'Política de cancelación',
      default: 'Cancelación gratuita hasta 48 horas antes del check-in',
      required: false,
    },
  },
  recommendedSkillTags: ['hospitalidad', 'reservas', 'turismo', 'precios-estacionales', 'multi-idioma'],
};

/**
 * Vehicles vertical — lead scoring, follow-up automation.
 */
export const vehiclesVerticalConfig: VerticalConfig = {
  id: 'vehicles',
  name: 'Concesionaria / Venta de vehículos',
  description:
    'Vertical para concesionarias y vendedores de vehículos. Incluye scoring de leads y gestión de seguimientos.',
  industry: 'automotriz',
  identityFragment:
    'Sos el asistente virtual de {businessName}, una {businessType}. Tu rol es calificar el interés de los clientes, informar sobre el stock disponible y coordinar con los asesores de ventas. Respondés con entusiasmo y conocimiento del rubro automotriz.',
  instructionsFragment:
    '## Protocolo de ventas - {businessName}\n- Marcas que comercializamos: {brands}\n- Horario de atención: {businessHours}\n- Siempre calificá al lead: presupuesto, urgencia y tipo de vehículo buscado\n- Leads "urgentes" y "calientes" tienen prioridad — notificá al asesor inmediatamente\n- Para test drives, coordinar turno previamente\n- Financiamiento disponible: {financingOptions}\n- Aceptamos usados como parte de pago: {tradeInPolicy}',
  tools: [
    {
      toolId: 'vehicle-lead-score',
      displayName: 'Calcular score del lead',
      description: 'Calcula la calidad del lead según presupuesto, urgencia y preferencias',
      defaultEnabled: true,
      riskLevel: 'low',
    },
    {
      toolId: 'vehicle-check-followup',
      displayName: 'Verificar seguimiento',
      description: 'Determina si el lead necesita seguimiento y cuándo',
      defaultEnabled: true,
      riskLevel: 'low',
    },
    {
      toolId: 'catalog-search',
      displayName: 'Buscar vehículos en stock',
      description: 'Busca vehículos disponibles según preferencias del cliente',
      defaultEnabled: true,
      riskLevel: 'low',
    },
  ],
  parametersSchema: {
    businessName: {
      type: 'string',
      label: 'Nombre de la concesionaria',
      required: true,
    },
    businessType: {
      type: 'enum',
      label: 'Tipo de negocio',
      options: ['concesionaria oficial', 'concesionaria multimarca', 'agencia de usados', 'moto shop'],
      default: 'concesionaria oficial',
      required: true,
    },
    brands: {
      type: 'string',
      label: 'Marcas comercializadas',
      required: true,
    },
    businessHours: {
      type: 'string',
      label: 'Horario de atención',
      required: true,
    },
    financingOptions: {
      type: 'string',
      label: 'Opciones de financiamiento',
      default: 'Plan de ahorro, crédito bancario y financiamiento propio',
      required: false,
    },
    tradeInPolicy: {
      type: 'string',
      label: 'Política de usados',
      default: 'Sí, aceptamos tu usado como parte de pago previo tasación',
      required: false,
    },
  },
  recommendedSkillTags: ['automotriz', 'ventas', 'lead-scoring', 'concesionaria'],
};

/**
 * Wholesale vertical — stock management, order history, tiered pricing.
 */
export const wholesaleVerticalConfig: VerticalConfig = {
  id: 'wholesale',
  name: 'Mayorista / Distribuidor',
  description:
    'Vertical para mayoristas y distribuidores. Incluye gestión de stock, historial de pedidos y precios por volumen.',
  industry: 'comercio-mayorista',
  identityFragment:
    'Sos el asistente virtual de {businessName}, un {businessType}. Ayudás a los clientes a consultar stock, precios, hacer pedidos y seguir sus compras. Conocés bien el catálogo y los niveles de descuento según categoría de cliente.',
  instructionsFragment:
    '## Protocolo de atención - {businessName}\n- Horario de atención: {businessHours}\n- Pedido mínimo: {minimumOrder}\n- Niveles de cliente: {customerTiers}\n- Siempre verificá el stock antes de confirmar disponibilidad\n- Para clientes nuevos, solicitá CUIT y razón social para dar de alta\n- Tiempo de entrega: {deliveryTime}\n- Condiciones de pago: {paymentTerms}\n- Para pedidos especiales o grandes volúmenes, derivar a ventas@{businessDomain}',
  tools: [
    {
      toolId: 'wholesale-update-stock',
      displayName: 'Actualizar inventario',
      description: 'Actualiza el stock desde CSV o manual',
      defaultEnabled: true,
      riskLevel: 'high',
    },
    {
      toolId: 'wholesale-order-history',
      displayName: 'Historial de pedidos',
      description: 'Consulta el historial y analytics de compras del cliente',
      defaultEnabled: true,
      riskLevel: 'low',
    },
    {
      toolId: 'catalog-search',
      displayName: 'Consultar catálogo y precios',
      description: 'Busca productos con stock y precios actualizados',
      defaultEnabled: true,
      riskLevel: 'low',
    },
  ],
  parametersSchema: {
    businessName: {
      type: 'string',
      label: 'Nombre del mayorista',
      required: true,
    },
    businessType: {
      type: 'enum',
      label: 'Tipo de negocio',
      options: ['mayorista', 'distribuidor', 'importador', 'fabricante'],
      default: 'mayorista',
      required: true,
    },
    businessHours: {
      type: 'string',
      label: 'Horario de atención',
      required: true,
    },
    minimumOrder: {
      type: 'string',
      label: 'Pedido mínimo',
      required: false,
    },
    customerTiers: {
      type: 'string',
      label: 'Niveles de cliente',
      default: 'Bronze, Silver, Gold, Platinum — cada nivel con descuentos crecientes',
      required: false,
    },
    deliveryTime: {
      type: 'string',
      label: 'Tiempo de entrega',
      default: '24-72 horas hábiles según zona',
      required: false,
    },
    paymentTerms: {
      type: 'string',
      label: 'Condiciones de pago',
      default: 'Contado, 30 días y 60 días según categoría de cliente',
      required: false,
    },
    businessDomain: {
      type: 'string',
      label: 'Dominio del negocio',
      description: 'Para armar el email de contacto',
      required: false,
    },
  },
  recommendedSkillTags: ['mayorista', 'stock', 'pedidos', 'precios-por-volumen', 'distribucion'],
};

// ─── Auto-registration ───────────────────────────────────────────

// Register TypeScript-defined verticals into the registry at module load time.
registerVertical(hotelsVerticalConfig);
registerVertical(vehiclesVerticalConfig);
registerVertical(wholesaleVerticalConfig);

// Re-export schema types and registry functions for convenience
export type { VerticalConfig, VerticalToolConfig, ParameterDef } from './vertical-config.schema.js';
export {
  getAllVerticals,
  getVertical,
  getVerticalsByIndustry,
  renderVerticalPrompt,
  registerVertical,
} from './vertical-registry.js';
