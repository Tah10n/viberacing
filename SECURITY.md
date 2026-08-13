# Security policy

## Reporting a vulnerability

Use GitHub's **Report a vulnerability** action to open a private security advisory. Do not disclose
security details in a public issue, pull request, discussion, commit message, or social post.

Include the affected component, realistic impact, minimal reproduction with synthetic data, and a
safe contact method. Do not send credentials, production database exports, or unrelated personal
data.

## Priority areas

- GitHub OAuth, sessions, browser pairing, and device authorization;
- cross-account access or mutation;
- usage tampering outside the documented self-reporting limitation;
- collection or disclosure of prompts, code, repositories, paths, or credentials;
- connector hook installation and local token storage;
- dependency, container, CI, and npm package supply chain.

Good-faith research must avoid accessing another person's data, persistence, destructive actions,
denial of service, social engineering, credential theft, and production testing when a local
reproduction is possible.
