# Vibe Racing connector

The connector detects Codex and Claude Code, opens the browser for pairing approval, and uploads
daily aggregate token totals. Node.js 20 or newer is required.

## Connect

```bash
npx @viberacing/connector connect --origin https://viberacing.example
```

Run the command on every computer that should participate. The site lists each computer separately
and lets the user disconnect it. Running `connect` again against the same origin replaces that
computer's connection and preserves its history.

The connector stores a random device token in `~/.viberacing/config.json` with user-only file
permissions. The token can submit totals but cannot read account data. Additive Codex `SessionEnd`
and Claude Code `Stop` hooks trigger background sync; Codex may ask the user to trust its hook.

If the browser cannot open automatically, use the verification URL printed in the terminal.

## Commands

```bash
npx @viberacing/connector sync    # send current totals now
npx @viberacing/connector doctor  # show detected agents and connection origin
```

The connector never uploads prompts, responses, code, repository names, paths, hostnames, provider
credentials, model names, or costs. See the
[privacy documentation](https://github.com/Tah10n/viberacing/blob/main/docs/PRIVACY.md).
