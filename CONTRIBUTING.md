# Contributing to AI Edu Workflow Tools

Thanks for your interest in contributing! This project welcomes issues, ideas,
and pull requests.

## Getting started

```bash
npm install
cp .env.example .env     # set AI_API_KEY for real model output (optional)
npm run dev              # Vite dev server (frontend)
npm start                # API + static server
```

You can develop most of the UI without any API key — text tools fall back to
local templates.

## Before you open a PR

- Run `npm run check` (TypeScript type-check + `node --check server.js`) and make
  sure it passes.
- Keep changes focused; open an issue first to discuss large or breaking changes.
- Match the existing code style (formatting, naming, file layout).
- Never commit secrets. `.env`, `data/`, and `output/` are git-ignored — keep it
  that way. Use `.env.example` to document any new environment variable.

## Reporting bugs

Open an issue with steps to reproduce, expected vs. actual behavior, and your
environment (OS, Node version). For security-sensitive reports, please contact
a maintainer privately instead of opening a public issue.

## Code of Conduct

Be respectful and constructive. We follow the spirit of the
[Contributor Covenant](https://www.contributor-covenant.org/).
