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
} from './types.js';

export {
  createCampaignRunner,
  interpolateTemplate,
  CampaignExecutionError,
} from './campaign-runner.js';
export type { CampaignRunner, CampaignRunnerDeps } from './campaign-runner.js';

export {
  markCampaignReply,
  markConversion,
  getCampaignMetrics,
} from './campaign-tracker.js';
export type { MarkReplyOptions } from './campaign-tracker.js';
