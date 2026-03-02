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
} from './types.js';

export {
  createCampaignRunner,
  interpolateTemplate,
  CampaignExecutionError,
} from './campaign-runner.js';
export type { CampaignRunner, CampaignRunnerDeps } from './campaign-runner.js';
