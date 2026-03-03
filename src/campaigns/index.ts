export type {
  CampaignId,
  CampaignSendId,
  CampaignStatus,
  CampaignSendStatus,
  CampaignChannel,
  AudienceFilter,
  Campaign,
  CampaignSend,
  CampaignReply,
  CampaignMetrics,
  CampaignExecutionResult,
  CampaignVariant,
  ABTestConfig,
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

export {
  markCampaignReply,
  markConversion,
  getCampaignMetrics,
} from './campaign-tracker.js';
export type { MarkReplyOptions } from './campaign-tracker.js';
