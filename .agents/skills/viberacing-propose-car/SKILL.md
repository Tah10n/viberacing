---
name: viberacing-propose-car
description:
  Turn a user's Vibe Racing pixel-car style request into one closed CarRecipeV1 and submit it
  through the already paired proposal-only connector command. Use when the user asks an agent to
  create, restyle, or propose their Vibe Racing car for later browser review; do not use it to
  connect, sync usage, inspect private state, approve, activate, publish, or administer a profile.
---

# Propose a Vibe Racing car

Reduce style intent locally to nine bounded fields, then invoke only the fixed `propose-car`
command. The service receives no prompt or conversation text, and the browser remains the only
approval boundary.

## Establish prerequisites

Require all of the following before invoking anything:

- an origin supplied explicitly for this request;
- an existing paired-device label supplied explicitly for this request; and
- a trusted `viberacing-connector` installation already selected by the user.

Never discover, download, build, update, or replace the connector. Never inspect the credential
store, environment, browser, logs, repository, or process list to infer an origin or label. If a
prerequisite is absent, stop and ask only for the missing value. The repository currently publishes
no supported connector release, so do not describe a local development binary as supported.

## Reduce the request locally

Create exactly one recipe with `schemaVersion` set to `1`, a seed from `0` through `65535`, and one
value from each row:

| Field   | Allowed values                                         |
| ------- | ------------------------------------------------------ |
| chassis | `formula`, `rally`, `roadster`                         |
| nose    | `classic`, `scoop`, `wedge`                            |
| cockpit | `canopy`, `open`, `rally`                              |
| wing    | `high`, `low`, `none`                                  |
| wheels  | `all-terrain`, `slick`, `street`                       |
| palette | `magenta`, `mint`, `redline`, `sunburst`, `turbo-blue` |
| trail   | `grid`, `none`, `spark`                                |

Use the closest generic project-owned combination. Do not imitate a real brand, logo, or protected
trade dress. Ask one concise styling question only when the request is too ambiguous to select a
combination; otherwise choose a coherent combination and a bounded integer seed. Never place
styling-request text, an arbitrary color, any URL other than the validated origin, a path, file,
markup, drawing command, or extra field in the recipe or invocation.

Show the selected fields before submission. Explain that the result will be a private pending
proposal and will not become active or public until the user separately approves it in the browser.

## Validate invocation inputs

Accept only a canonical origin with no credentials, path, query, or fragment. Build it as an allowed
scheme, the literal `://` delimiter, and one authority matching the corresponding shell-safe
grammar:

```regex
remote: scheme = ^https$
remote: authority = ^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::[0-9]{1,5})?$
local: scheme = ^http$
local: authority = ^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$
```

If a port is present, parse it as a decimal integer from `1` through `65535`.

Require the label to match `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. This skill deliberately refuses
otherwise valid connector labels because every value passed through an agent shell must be a single
shell-safe token. Require the seed to contain decimal digits only and recheck its numeric bound.

If any value fails these narrower rules, stop without invoking the connector. Do not escape,
transform, truncate, or interpolate rejected input.

## Submit once

Invoke exactly this command shape, passing each displayed value as its own argument:

```text
viberacing-connector propose-car --origin <origin> --label <label> --chassis <chassis> --nose <nose> --cockpit <cockpit> --wing <wing> --wheels <wheels> --palette <palette> --trail <trail> --seed <seed>
```

Prefer a tool interface that accepts an argument vector. If only a shell command string is
available, render the command only after every value has passed the shell-safe grammar above. Do not
add quoting, redirection, environment assignments, pipes, command substitution, extra flags, or a
second command. Do not invoke `connect`, `sync`, a direct HTTP client, an App Server method, or any
database or browser endpoint.

Make one attempt only. Do not retry an ambiguous or failed submission. Treat success as proven only
when the process exits successfully and emits exactly:

```text
Car proposal submitted. Review it in your account.
```

On success, tell the user to review the private proposal in their Vibe Racing account. On any other
result, say that submission was not confirmed and that the proposal may still be pending, then tell
the user to reconcile it in the account. Do not echo raw process output or infer whether the server
stored a proposal.
