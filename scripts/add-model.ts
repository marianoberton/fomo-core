#!/usr/bin/env tsx
/**
 * Helper script to add a new model to the registry.
 *
 * Usage:
 *   pnpm add-model <model-id> <provider> <context> <maxOutput> <inputPrice> <outputPrice>
 *
 * Example:
 *   pnpm add-model claude-4-opus-20260201 anthropic 300000 64000 20 100
 *   pnpm add-model gpt-5-turbo openai 256000 32768 5 15
 */

const args = process.argv.slice(2);

if (args.length < 6) {
  console.error('Usage: pnpm add-model <model-id> <provider> <context> <maxOutput> <inputPrice> <outputPrice>');
  console.error('');
  console.error('Example:');
  console.error('  pnpm add-model claude-4-opus-20260201 anthropic 300000 64000 20 100');
  process.exit(1);
}

const [modelId, provider, contextStr, maxOutputStr, inputPriceStr, outputPriceStr] = args;

const contextWindow = parseInt(contextStr, 10);
const maxOutputTokens = parseInt(maxOutputStr, 10);
const inputPricePer1M = parseFloat(inputPriceStr);
const outputPricePer1M = parseFloat(outputPriceStr);

if (isNaN(contextWindow) || isNaN(maxOutputTokens) || isNaN(inputPricePer1M) || isNaN(outputPricePer1M)) {
  console.error('Error: context, maxOutput, inputPrice, and outputPrice must be valid numbers');
  process.exit(1);
}

const entry = `  '${modelId}': {
    contextWindow: ${contextWindow.toLocaleString('en-US').replace(/,/g, '_')},
    maxOutputTokens: ${maxOutputTokens.toLocaleString('en-US').replace(/,/g, '_')},
    supportsTools: true,
    inputPricePer1M: ${inputPricePer1M},
    outputPricePer1M: ${outputPricePer1M},
  },`;

console.log('\n✅ Add this to src/providers/models.ts under the appropriate provider section:\n');
console.log(entry);
console.log('\n📝 Then update the LAST UPDATED comment at the top of the file.\n');
