/**
 * Skills Module — Public API
 */
export type {
  SkillTemplate,
  SkillInstance,
  SkillCategory,
  SkillTemplateStatus,
  SkillInstanceStatus,
  SkillComposition,
  SkillRepository,
  CreateSkillInstanceInput,
  UpdateSkillInstanceInput,
} from './types.js';

export { createSkillRepository } from './skill-repository.js';
export { createSkillService } from './skill-service.js';
export type { SkillService } from './skill-service.js';
