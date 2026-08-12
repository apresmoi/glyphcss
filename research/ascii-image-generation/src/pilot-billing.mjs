// GPT Image 1.5's response usage schema is deliberately strict here. A live run
// must map the provider's documented fields to these values before continuing;
// absent or guessed usage is not evidence that the cap remains available.
export function reconcilePilotUsage({ pricing, outputCostPerCandidateUsd }, accountedUsd, candidates, usage) {
  if (!usage || !Number.isFinite(usage.textInputTokens) || usage.textInputTokens < 0 || !Number.isFinite(usage.imageInputTokens) || usage.imageInputTokens < 0) throw new Error("PILOT_USAGE_RECONCILIATION_REQUIRED");
  const textUsd = usage.textInputTokens * pricing.textInputUsdPerMillionTokens / 1_000_000;
  const imageUsd = usage.imageInputTokens * pricing.imageInputUsdPerMillionTokens / 1_000_000;
  const outputUsd = candidates * outputCostPerCandidateUsd;
  const money = (value) => Math.round(value * 1_000_000) / 1_000_000;
  const totalUsd = money(textUsd + imageUsd + outputUsd);
  return { textUsd: money(textUsd), imageUsd: money(imageUsd), outputUsd: money(outputUsd), totalUsd, accountedUsd: money(accountedUsd + totalUsd) };
}

// The Images API reports input token use below `usage.input_tokens_details`.
// Keep this conversion at the provider boundary: accepting old flat fields would
// make a fabricated fixture indistinguishable from an actual API response.
export function parseOpenAIImageUsage(usage) {
  const details = usage?.input_tokens_details;
  const textInputTokens = details?.text_tokens;
  const imageInputTokens = details?.image_tokens;
  if (!Number.isSafeInteger(textInputTokens) || textInputTokens < 0
    || !Number.isSafeInteger(imageInputTokens) || imageInputTokens < 0) {
    throw new Error("PILOT_USAGE_RECONCILIATION_REQUIRED");
  }
  return { textInputTokens, imageInputTokens };
}

export function validateProviderSpendPrerequisite(prerequisite) {
  if (!prerequisite || typeof prerequisite.dedicatedProjectId !== "string" || !prerequisite.dedicatedProjectId
    || prerequisite.hardLimitEnabled !== true || !Number.isFinite(prerequisite.monthlyHardLimitUsd)
    || prerequisite.monthlyHardLimitUsd <= 0 || !Number.isFinite(prerequisite.trackedSpendBaselineUsd)
    || prerequisite.trackedSpendBaselineUsd < 0 || prerequisite.trackedSpendBaselineUsd >= prerequisite.monthlyHardLimitUsd
    || typeof prerequisite.confirmation !== "string" || !prerequisite.confirmation) throw new Error("PILOT_PROVIDER_HARD_LIMIT_CONFIRMATION_REQUIRED");
  return { effectiveRemainingProjectAllowanceUsd: prerequisite.monthlyHardLimitUsd - prerequisite.trackedSpendBaselineUsd };
}
export const PILOT_PRICING = Object.freeze({
  sources: Object.freeze([
    "https://developers.openai.com/api/docs/pricing",
    "https://developers.openai.com/api/docs/guides/image-generation#calculating-costs",
  ]),
  checkedOn: "2026-07-23",
  textInputUsdPerMillionTokens: 5,
  imageInputUsdPerMillionTokens: 8,
  outputUsdPerMedium1024Png: .034,
  outputCostPerCandidateUsd: .034,
});

export function validatePilotPricing(pricing, outputCostPerCandidateUsd = pricing?.outputCostPerCandidateUsd) {
  for (const [key, value] of Object.entries(PILOT_PRICING)) {
    if (Array.isArray(value)) {
      if (!Array.isArray(pricing?.[key]) || pricing[key].length !== value.length || pricing[key].some((item, index) => item !== value[index])) throw new Error("PILOT_PRICING_CONFIG_DRIFT");
    } else if (pricing?.[key] !== value) throw new Error("PILOT_PRICING_CONFIG_DRIFT");
  }
  if (pricing.outputCostPerCandidateUsd !== PILOT_PRICING.outputUsdPerMedium1024Png
    || outputCostPerCandidateUsd !== PILOT_PRICING.outputUsdPerMedium1024Png) throw new Error("PILOT_PRICING_CONFIG_DRIFT");
  return PILOT_PRICING;
}
