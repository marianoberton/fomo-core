// Individual tool implementations
export { createEscalateToHumanTool } from './escalate-to-human.js';

export { createCalculatorTool } from './calculator.js';
export { createDateTimeTool } from './date-time.js';
export { createJsonTransformTool } from './json-transform.js';
export { createHttpRequestTool } from './http-request.js';
export type { HttpRequestToolOptions } from './http-request.js';
export { createKnowledgeSearchTool } from './knowledge-search.js';
export type { KnowledgeSearchToolOptions } from './knowledge-search.js';
export { createSendNotificationTool } from './send-notification.js';
export type { SendNotificationToolOptions, NotificationSender } from './send-notification.js';
export { createProposeScheduledTaskTool } from './propose-scheduled-task.js';
export type { ProposeScheduledTaskToolOptions } from './propose-scheduled-task.js';
export { createCatalogSearchTool } from './catalog-search.js';
export type { CatalogSearchToolOptions } from './catalog-search.js';
export { createCatalogOrderTool } from './catalog-order.js';
export type { CatalogOrderToolOptions } from './catalog-order.js';

// Phase 5 tools
export { createWebSearchTool } from './web-search.js';
export type { WebSearchToolOptions } from './web-search.js';
export { createSendEmailTool } from './send-email.js';
export type { SendEmailToolOptions } from './send-email.js';
export { createSendChannelMessageTool } from './send-channel-message.js';
export type { SendChannelMessageToolOptions } from './send-channel-message.js';
export { createReadFileTool } from './read-file.js';
export type { ReadFileToolOptions } from './read-file.js';
export { createScrapeWebpageTool } from './scrape-webpage.js';

// Manager / orchestration tools
export { createExportConversationsTool } from './export-conversations.js';
export type { ExportConversationsToolOptions } from './export-conversations.js';
export { createAlertRuleTool } from './create-alert-rule.js';
export type { CreateAlertRuleToolOptions } from './create-alert-rule.js';
export { createControlAgentTool } from './control-agent.js';
export type { ControlAgentToolOptions } from './control-agent.js';
export { createDelegateToAgentTool } from './delegate-to-agent.js';
export type { DelegateToAgentToolOptions, RunSubAgentFn } from './delegate-to-agent.js';
export { createListProjectAgentsTool } from './list-project-agents.js';
export type { ListProjectAgentsToolOptions } from './list-project-agents.js';
export { createGetOperationsSummaryTool } from './get-operations-summary.js';
export type { GetOperationsSummaryToolOptions } from './get-operations-summary.js';
export { createGetAgentPerformanceTool } from './get-agent-performance.js';
export type { GetAgentPerformanceToolOptions } from './get-agent-performance.js';
export { createReviewAgentActivityTool } from './review-agent-activity.js';
export type { ReviewAgentActivityToolOptions } from './review-agent-activity.js';

// Memory tools
export { createStoreMemoryTool } from './store-memory.js';
export type { StoreMemoryToolOptions } from './store-memory.js';
export { createSearchProjectMemoryTool } from './search-project-memory.js';
export type { SearchProjectMemoryToolOptions } from './search-project-memory.js';

// Shared memory / session tools (internal mode)
export { createQuerySessionsTool } from './query-sessions.js';
export type { QuerySessionsToolOptions } from './query-sessions.js';
export { createReadSessionHistoryTool } from './read-session-history.js';
export type { ReadSessionHistoryToolOptions } from './read-session-history.js';

// Campaign tools
export { createTriggerCampaignTool } from './trigger-campaign.js';
export type { TriggerCampaignToolOptions } from './trigger-campaign.js';

// Generic contact scoring
export { createContactScoreTool } from './contact-score.js';

// CRM integrations
export { createTwentyCrmTool } from './create-twenty-lead.js';
export { createTwentyUpdateTool } from './update-twenty-lead.js';
export type { TwentyCrmToolOptions } from './create-twenty-lead.js';

// Vertical-specific tools
export { createVehicleLeadScoreTool } from './vehicle-lead-score.js';
export { createVehicleCheckFollowupTool } from './vehicle-check-followup.js';
export { createWholesaleUpdateStockTool } from './wholesale-update-stock.js';
export { createWholesaleOrderHistoryTool } from './wholesale-order-history.js';
export { createHotelDetectLanguageTool } from './hotel-detect-language.js';
export { createHotelSeasonalPricingTool } from './hotel-seasonal-pricing.js';
