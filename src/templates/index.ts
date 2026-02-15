/**
 * Vertical Templates
 * Pre-configured setups for common business verticals
 */

// Template definitions
export * from './car-dealership.js';
export * from './wholesale-hardware.js';
export * from './boutique-hotel.js';

// Template manager
export { TemplateManager, VERTICAL_TEMPLATES } from './template-manager.js';
export type {
  VerticalTemplate,
  CreateProjectFromTemplateParams,
} from './template-manager.js';
