# x-claude-code

OpenClaw provider plugin: Claude Code models through an AxonHub gateway (Anthropic format).

- Provider `x-claude-code/`, shown in the model picker as **X Claude Code**.
- Models: models with `owned_by: claudecode`, discovered live from AxonHub's `/v1/models`. New models appear after a Refresh in the model picker, or once the 60 s discovery cache expires.
- Embedding and other non-chat models are filtered out.
- Adding a key never replaces the primary model chosen in the UI.

## API address and key

Set them in the OpenClaw UI (**Plugins → X Claude Code → Settings**) or with env vars. The UI setting wins.

| Setting | UI field | Env var | Example |
| ------- | -------- | ------- | ------- |
| API address | `baseUrl` | `X_CLAUDE_CODE_BASE_URL` | `https://axonhub.example.com/anthropic` |
| API key | `apiKey` | `X_CLAUDE_CODE_API_KEY` | API key |
| Context window | `contextWindow` | `X_CLAUDE_CODE_CONTEXT_WINDOW` | optional, default `1000000` |

The key can also be saved as an auth profile under **Settings → Model providers**, or with `openclaw models auth paste-api-key --provider x-claude-code`. Order: UI `apiKey`, then the auth profile, then the env var.

`x-claude-code` reads its model list from `<origin>/v1/models`, since AxonHub serves it on the OpenAI route.

With Docker Compose, the container only sees variables passed under `environment:`, e.g. `- X_CLAUDE_CODE_API_KEY=${X_CLAUDE_CODE_API_KEY}`.

## Install into an OpenClaw container

The plugin lives on the data volume, so it survives redeploys.

```sh
C=<openclaw container>
docker exec $C rm -rf /data/plugins/x-claude-code
docker cp . $C:/data/plugins/x-claude-code
# OpenClaw ignores plugin dirs that are not root-owned or are group-writable
docker exec $C sh -c 'rm -rf /data/plugins/x-claude-code/.git && chown -R root:root /data/plugins/x-claude-code && chmod 755 /data/plugins/x-claude-code && chmod 644 /data/plugins/x-claude-code/*'
docker exec $C openclaw plugins install --link /data/plugins/x-claude-code --force
```

## Update after editing

Run the first three commands above again, then:

```sh
docker exec $C openclaw plugins reload x-claude-code
```
