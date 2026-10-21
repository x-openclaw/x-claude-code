// OpenClaw provider plugin: Claude Code models through an AxonHub gateway (Anthropic format).
//
// Provider x-claude-code/, Anthropic format, models with owned_by "claudecode".
// API address and key, first match wins:
//   address: plugin settings in the UI (baseUrl), then env X_CLAUDE_CODE_BASE_URL
//   key:     plugin settings in the UI (apiKey), then a saved auth profile, then env X_CLAUDE_CODE_API_KEY
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

// Shown when discovery fails, so the Claude models never disappear from the picker.
const SEED_IDS = ["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];

const text = (value) => (typeof value === "string" ? value.trim() : "");

function readSettings(api) {
  const cfg = api.pluginConfig ?? {};
  return {
    baseUrl: (text(cfg.baseUrl) || text(process.env.X_CLAUDE_CODE_BASE_URL)).replace(/\/+$/, ""),
    apiKey: text(cfg.apiKey),
    contextWindow: Number(cfg.contextWindow) || Number(process.env.X_CLAUDE_CODE_CONTEXT_WINDOW) || DEFAULT_CONTEXT_WINDOW,
  };
}

function buildProvider(s) {
  return {
    baseUrl: s.baseUrl,
    api: "anthropic-messages",
    ...(s.apiKey ? { apiKey: s.apiKey } : {}),
    models: SEED_IDS.map((id) => claudeModel(id, s.contextWindow)),
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
                ).map((model) => ({ ...model, ...claudeModel(model.id, s.contextWindow) })),
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
