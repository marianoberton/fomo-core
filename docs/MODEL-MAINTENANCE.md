# Model Registry Maintenance

## Overview

The model registry in `src/providers/models.ts` contains pricing and capabilities for LLM models. This needs to be updated regularly as providers release new models or change pricing.

**Last Updated:** 2026-02-10

---

## How to Add a New Model

### Option 1: Helper Script (Recommended)

```bash
pnpm add-model <model-id> <provider> <context> <maxOutput> <inputPrice> <outputPrice>
```

**Example:**
```bash
# Add Claude 4 Opus (hypothetical)
pnpm add-model claude-4-opus-20260201 anthropic 300000 64000 20 100

# Add GPT-5 Turbo (hypothetical)
pnpm add-model gpt-5-turbo openai 256000 32768 5 15
```

The script will generate the code snippet to copy into `models.ts`.

### Option 2: Manual Edit

1. Open `src/providers/models.ts`
2. Find the appropriate provider section (Anthropic, OpenAI, Google)
3. Add a new entry:

```typescript
'your-model-id': {
  contextWindow: 128_000,       // Max context window in tokens
  maxOutputTokens: 16_384,      // Max output tokens per request
  supportsTools: true,          // Whether model supports function calling
  inputPricePer1M: 2.5,        // Cost per 1M input tokens (USD)
  outputPricePer1M: 10,        // Cost per 1M output tokens (USD)
},
```

4. Update the `LAST UPDATED` comment at the top

---

## Where to Find Model Info

### Anthropic (Claude)
- **Pricing:** https://www.anthropic.com/pricing
- **Docs:** https://docs.anthropic.com/en/docs/models-overview
- **Model IDs:** `claude-3-5-sonnet-20241022`, `claude-3-opus-20240229`, etc.

### OpenAI (GPT)
- **Pricing:** https://openai.com/api/pricing/
- **Docs:** https://platform.openai.com/docs/models
- **Model IDs:** `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `o1-preview`, etc.

### Google (Gemini)
- **Pricing:** https://ai.google.dev/pricing
- **Docs:** https://ai.google.dev/gemini-api/docs/models
- **Model IDs:** `gemini-2.0-flash-exp`, `gemini-1.5-pro`, `gemini-1.5-flash`, etc.

---

## Maintenance Schedule

**Recommended:** Check for updates monthly

### Monthly Checklist
- [ ] Check Anthropic pricing page for new models or price changes
- [ ] Check OpenAI pricing page for new models or price changes
- [ ] Check Google AI pricing page for new models or price changes
- [ ] Update `models.ts` with any changes
- [ ] Update `LAST UPDATED` comment
- [ ] Run `pnpm typecheck` to verify
- [ ] Test with `pnpm chat` using new models

### How to Test a New Model
1. Add model to `models.ts`
2. Create a test project with the new model:
   ```bash
   curl -X POST http://localhost:3002/projects \
     -H "Content-Type: application/json" \
     -d '{
       "name": "Test GPT-5",
       "config": {
         "provider": {
           "provider": "openai",
           "model": "gpt-5-turbo",
           "apiKeyEnvVar": "OPENAI_API_KEY"
         },
         ...
       }
     }'
   ```
3. Chat with it: `pnpm chat --project <id>`
4. Verify token counts and costs display correctly

---

## Fallback Behavior

If a model isn't in the registry, Nexus uses conservative defaults:

```typescript
{
  contextWindow: 8_192,
  maxOutputTokens: 4_096,
  supportsTools: true,
  inputPricePer1M: 10,      // High to avoid cost surprises
  outputPricePer1M: 30,
}
```

So unknown models will work, but costs may be overestimated.

---

## Current Models (as of 2026-02-10)

### Anthropic
- ✅ claude-3-5-sonnet-20241022 ($3/$15 per 1M)
- ✅ claude-3-5-haiku-20241022 ($0.8/$4 per 1M)
- ✅ claude-3-opus-20240229 ($15/$75 per 1M)
- ✅ claude-3-sonnet-20240229 ($3/$15 per 1M)
- ✅ claude-3-haiku-20240307 ($0.25/$1.25 per 1M)

### OpenAI
- ✅ gpt-4o ($2.5/$10 per 1M)
- ✅ gpt-4o-mini ($0.15/$0.6 per 1M)
- ✅ gpt-4-turbo ($10/$30 per 1M)
- ✅ o1-preview ($15/$60 per 1M, no tools)
- ✅ o1-mini ($3/$12 per 1M, no tools)

### Google
- ✅ gemini-2.0-flash-exp (Free during preview)
- ✅ gemini-1.5-pro ($1.25/$5 per 1M)
- ✅ gemini-1.5-flash ($0.075/$0.3 per 1M)
- ✅ gemini-1.5-flash-8b ($0.0375/$0.15 per 1M)

---

## Notes

- **Tool support:** o1 models don't support function calling yet
- **Experimental models:** Gemini 2.0 Flash is free during preview
- **Legacy models:** Keep old models in registry for backward compatibility with existing projects
- **Pricing changes:** Providers sometimes update pricing without changing model IDs — check monthly

---

## Example: Adding a Brand New Model

Say OpenAI releases **GPT-5 Turbo** on 2026-03-01:

1. Check pricing page: $5 per 1M input, $15 per 1M output
2. Check docs: 256k context, 32k max output, supports tools
3. Run helper:
   ```bash
   pnpm add-model gpt-5-turbo openai 256000 32768 5 15
   ```
4. Copy output to `models.ts` under OpenAI section
5. Update `LAST UPDATED: 2026-03-01`
6. Commit:
   ```bash
   git add src/providers/models.ts
   git commit -m "feat(models): add GPT-5 Turbo support"
   ```
7. Test with `pnpm chat`
