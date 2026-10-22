// OpenClaw provider plugin: Claude Code models through an AxonHub gateway (Anthropic format).
//
// Provider x-claude-code/, Anthropic format, models with owned_by "claudecode".
// API address and key, first match wins:
//   address: plugin settings in the UI (baseUrl), then env X_CLAUDE_CODE_BASE_URL
//   key:     plugin settings in the UI (apiKey), then a saved auth profile, then env X_CLAUDE_CODE_API_KEY
// Context window: contextWindow (X_CLAUDE_CODE_CONTEXT_WINDOW) when set, otherwise models.dev
// (modelsDev / X_CLAUDE_CODE_MODELS_DEV, default on), otherwise 1M.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  buildOpenAICompatibleLiveModels,
  buildOpenAICompatibleLiveProviderCatalog,
} from "openclaw/plugin-sdk/provider-catalog-live-runtime";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-entry";

const PROVIDER_ID = "x-claude-code";

const DEFAULT_CONTEXT_WINDOW = 1_000_000;

// claude-sonnet-5-5 -> "Claude Sonnet 5.5"
function claudeName(id) {
  const [vendor, family, ...version] = id.split("-");
  if (vendor !== "claude" || !family || version.length === 0) return id;
  return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join(".")}`;
}

function claudeModel(id, contextWindow) {
  return { id, name: claudeName(id), reasoning: true, input: ["text", "image"], contextWindow };
}

// models.dev limits, keyed by a normalized model id. Fetched at most once a day.
const MODELS_DEV_URL = "https://models.dev/api.json";
const MODELS_DEV_TTL_MS = 24 * 60 * 60 * 1000;
const PREFERRED_SOURCES = ["anthropic"];
// Effort and mode variants share the limits of their base model.
const VARIANT_SUFFIX = /-(high|medium|low|extra-low|minimal|xhigh|tiered|thinking|agent)$/;
const REPORTED_CONTEXT_FIELDS = ["context_length", "context_window", "contextWindow", "max_context_length"];
let modelsDevCache = { at: 0, limits: null };

// "ollama/gpt-oss:120b" -> "gpt-oss-120b", "glm-5.1" -> "glm-5-1"
const normalizeId = (id) => id.toLowerCase().split("/").pop().replace(/[._:]/g, "-");

async function loadModelsDevLimits(signal) {
  if (modelsDevCache.limits && Date.now() - modelsDevCache.at < MODELS_DEV_TTL_MS) return modelsDevCache.limits;
  try {
    const timeout = AbortSignal.timeout(15000);
    const res = await fetch(MODELS_DEV_URL, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const catalog = await res.json();
    const sources = [...PREFERRED_SOURCES.filter((p) => catalog[p]), ...Object.keys(catalog).filter((p) => !PREFERRED_SOURCES.includes(p))];
    const limits = new Map();
    for (const source of sources) {
      for (const [id, model] of Object.entries(catalog[source]?.models ?? {})) {
        const key = normalizeId(id);
        const context = Number(model?.limit?.context);
        if (!limits.has(key) && context > 0) limits.set(key, { context, output: Number(model?.limit?.output) || undefined });
      }
    }
    modelsDevCache = { at: Date.now(), limits };
  } catch {
    // Keep the last good copy; without one, models fall back to the defaults.
  }
  return modelsDevCache.limits;
}

function lookupLimits(limits, id) {
  const key = normalizeId(id);
  return limits?.get(key) ?? limits?.get(key.replace(VARIANT_SUFFIX, ""));
}

// Shown when discovery fails, so the Claude models never disappear from the picker.
const SEED_IDS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

const text = (value) => (typeof value === "string" ? value.trim() : "");
const flag = (value, fallback) =>
  typeof value === "boolean" ? value : text(value) ? /^(1|true|yes|on)$/i.test(text(value)) : fallback;

function readSettings(api) {
  const cfg = api.pluginConfig ?? {};
  return {
    baseUrl: (text(cfg.baseUrl) || text(process.env.X_CLAUDE_CODE_BASE_URL)).replace(/\/+$/, ""),
    apiKey: text(cfg.apiKey),
    contextWindow: Number(cfg.contextWindow) || Number(process.env.X_CLAUDE_CODE_CONTEXT_WINDOW) || undefined,
    modelsDev: flag(cfg.modelsDev ?? process.env.X_CLAUDE_CODE_MODELS_DEV, true),
  };
}

function buildProvider(s) {
  return {
    baseUrl: s.baseUrl,
    api: "anthropic-messages",
    ...(s.apiKey ? { apiKey: s.apiKey } : {}),
    models: SEED_IDS.map((id) => claudeModel(id, s.contextWindow ?? DEFAULT_CONTEXT_WINDOW)),
  };
}

export default definePluginEntry({
  id: PROVIDER_ID,
  name: "X Claude Code",
  description: "Claude Code models through an AxonHub gateway (Anthropic format)",
  register(api) {
    const s = readSettings(api);
    if (!s.baseUrl) {
      api.logger?.warn?.(`${PROVIDER_ID}: no API address; set baseUrl in the plugin settings or X_CLAUDE_CODE_BASE_URL`);
    }
    api.registerProvider({
      id: PROVIDER_ID,
      label: "X Claude Code",
      docsPath: "/concepts/model-providers",
      envVars: ["X_CLAUDE_CODE_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: PROVIDER_ID,
          methodId: "api-key",
          label: "Claude Code API key",
          optionKey: "xClaudeCodeApiKey",
          flagName: "--x-claude-code-api-key",
          envVar: "X_CLAUDE_CODE_API_KEY",
          promptMessage: "Enter Claude Code API key",
          defaultModel: `${PROVIDER_ID}/claude-sonnet-5-5`,
          // Adding a key never replaces the primary model picked in the UI.
          preserveExistingPrimary: true,
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx) => {
          if (!s.baseUrl) return null;
          const auth = s.apiKey ? { apiKey: s.apiKey } : ctx.resolveProviderApiKey(PROVIDER_ID);
          if (!auth.apiKey) return null;
          const limits = s.modelsDev && !s.contextWindow ? await loadModelsDevLimits(ctx.signal) : null;
          return await buildOpenAICompatibleLiveProviderCatalog({
            providerId: PROVIDER_ID,
            providerConfig: buildProvider(s),
            apiKey: auth.apiKey,
            discoveryApiKey: auth.discoveryApiKey,
            profileId: auth.profileId,
            signal: ctx.signal,
            modelDiscovery: {
              // The model list lives on AxonHub's OpenAI route, not under /anthropic.
              endpointUrl: {
                url: `${s.baseUrl.replace(/\/anthropic(\/v1)?$/, "")}/v1/models`,
                requireBaseUrl: s.baseUrl,
              },
              projectRows: (rows, fallback) =>
                buildOpenAICompatibleLiveModels(
                  rows.filter((row) => row?.owned_by === "claudecode"),
                  fallback,
                ).map((model) => {
                  const found = s.contextWindow ? undefined : lookupLimits(limits, model.id);
                  return {
                    ...model,
                    ...claudeModel(model.id, s.contextWindow ?? found?.context ?? DEFAULT_CONTEXT_WINDOW),
                    ...(found?.output ? { maxTokens: Math.min(found.output, found.context) } : {}),
                  };
                }),
            },
          });
        },
      },
      staticCatalog: {
        order: "simple",
        run: async () => (s.baseUrl ? { provider: buildProvider(s) } : null),
      },
    });
  },
});
