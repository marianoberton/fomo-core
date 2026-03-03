export type {
  CampaignId,
  CampaignSendId,
  CampaignStatus,
  CampaignSendStatus,
  CampaignChannel,
  AudienceFilter,
  Campaign,
  CampaignSend,
  CampaignExecutionResult,
  CampaignVariant,
  ABTestConfig,
  CampaignReply,
  CampaignMetrics,
  CampaignVariantMetrics,
  ABTestResult,
} from './types.js';

export {
  createCampaignRunner,
  interpolateTemplate,
  CampaignExecutionError,
} from './campaign-runner.js';
export type { CampaignRunner, CampaignRunnerDeps } from './campaign-runner.js';

export {
  selectVariant,
  calculateWinner,
  getVariantMetrics,
  checkAndSelectWinner,
} from './ab-test-engine.js';
