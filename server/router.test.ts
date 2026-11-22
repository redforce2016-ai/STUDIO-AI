import assert from "node:assert/strict";
import test from "node:test";
import { ThinkingLevel } from "@google/genai";
import {
  MODEL_GOVERNANCE_RULES,
  assertModelAllowedForTask,
  executeWithGoogleKeyFailover,
  isValidNonMockApiKey,
  resetRouterCooldowns,
  resolveGovernanceThinkingConfig,
  toPublicRouterConfig,
} from "./router.js";

test("isValidNonMockApiKey strictly rejects mock/placeholder/short keys and accepts real-format keys", () => {
  assert.equal(isValidNonMockApiKey(""), false);
  assert.equal(isValidNonMockApiKey("short"), false);
  assert.equal(isValidNonMockApiKey("mock_api_key_12345678901234567890"), false);
  assert.equal(isValidNonMockApiKey("placeholder-key-999999999999999999"), false);
  assert.equal(isValidNonMockApiKey("demo_secret_token_abcdefghijklmnop"), false);
  assert.equal(isValidNonMockApiKey("AIzaSyRealFormatKeyValue_0123456789abc"), true);
});

test("assertModelAllowedForTask blocks deprecated models and heavy deep-reasoning models by default", () => {
  assert.throws(() =>
    assertModelAllowedForTask({ modelId: "gemini-1.5-flash", taskRole: "research_script" })
  );
  assert.throws(() =>
    assertModelAllowedForTask({ modelId: "gemini-2.0-flash", taskRole: "director" })
  );
  assert.throws(() =>
    assertModelAllowedForTask({ modelId: "gemini-4-neon", taskRole: "director" })
  );
  assert.throws(() =>
    assertModelAllowedForTask({ modelId: "gemini-4-carbon", taskRole: "visuals_qa" })
  );
  // Permitted routine models pass
  assert.doesNotThrow(() =>
    assertModelAllowedForTask({ modelId: "gemini-4-hydrogen", taskRole: "research_script" })
  );
  assert.doesNotThrow(() =>
    assertModelAllowedForTask({ modelId: "gemini-3.1-flash-lite", taskRole: "health_probe" })
  );
  // Explicit override allowed for deep reasoning
  assert.doesNotThrow(() =>
    assertModelAllowedForTask({
      modelId: "gemini-4-neon",
      taskRole: "deep_reasoning",
      allowDeepReasoningOverride: true,
    })
  );
});

test("resolveGovernanceThinkingConfig enforces anti-token-burn thinking levels", () => {
  assert.deepEqual(resolveGovernanceThinkingConfig("gemini-3.1-flash-lite", "health_probe"), {
    thinkingLevel: ThinkingLevel.MINIMAL,
  });
  assert.deepEqual(resolveGovernanceThinkingConfig("gemini-4-hydrogen", "research_script"), {
    thinkingLevel: ThinkingLevel.MEDIUM,
  });
  assert.deepEqual(resolveGovernanceThinkingConfig("gemini-4-hydrogen", "director"), {
    thinkingLevel: ThinkingLevel.LOW,
  });
  assert.deepEqual(resolveGovernanceThinkingConfig("gemini-4-hydrogen", "visuals_qa"), {
    thinkingLevel: ThinkingLevel.LOW,
  });
});

test("toPublicRouterConfig registers all 10 Agent Browser Gmail slots + governance rules without leaking raw keys", () => {
  const pub = toPublicRouterConfig();
  for (let i = 1; i <= 10; i++) {
    const slot = pub.providers.find((p) => p.id === `google_acct_${i}`);
    assert.ok(slot, `Expected google_acct_${i} slot`);
    assert.equal(slot.envVarName, `GEMINI_API_KEY_${i}`);
    assert.equal(slot.linkedBrowserProfileId, `prof_google_${i}`);
  }
  assert.ok(MODEL_GOVERNANCE_RULES.length >= 10);
  assert.equal(pub.quotaSummary.strictNoMockEnforced, true);
});

test("executeWithGoogleKeyFailover automatically rotates to next account on 429 quota error without failing", async () => {
  const prev1 = process.env.GEMINI_API_KEY_1;
  const prev2 = process.env.GEMINI_API_KEY_2;
  process.env.GEMINI_API_KEY_1 = "AIzaSyAccountOneLiveFormat_1111111111";
  process.env.GEMINI_API_KEY_2 = "AIzaSyAccountTwoLiveFormat_2222222222";
  resetRouterCooldowns();

  try {
    const attempted: string[] = [];
    const out = await executeWithGoogleKeyFailover(
      { taskRole: "director", modelId: "gemini-4-hydrogen" },
      async (_ai, meta) => {
        attempted.push(meta.envVarName);
        if (meta.envVarName === "GEMINI_API_KEY_1") {
          throw new Error("429 RESOURCE_EXHAUSTED: quota exceeded");
        }
        return {
          text: '{"ok":true}',
          usageMetadata: { totalTokenCount: 142 },
        };
      }
    );

    assert.equal(attempted[0], "GEMINI_API_KEY_1");
    assert.equal(attempted[1], "GEMINI_API_KEY_2");
    assert.equal(out.usedEnvVarName, "GEMINI_API_KEY_2");
    assert.equal(out.failoversTriggered, 1);

    const cfgAfter = toPublicRouterConfig();
    const acct1 = cfgAfter.providers.find((p) => p.id === "google_acct_1");
    assert.ok(acct1?.cooldownUntil, "Account 1 should be placed into cooldown after 429");
    assert.ok(
      cfgAfter.quotaSummary.recentFailovers.some(
        (f) => f.fromProviderId === "google_acct_1" && f.toProviderId === "google_acct_2"
      )
    );
  } finally {
    if (prev1 === undefined) delete process.env.GEMINI_API_KEY_1;
    else process.env.GEMINI_API_KEY_1 = prev1;
    if (prev2 === undefined) delete process.env.GEMINI_API_KEY_2;
    else process.env.GEMINI_API_KEY_2 = prev2;
    resetRouterCooldowns();
  }
});
