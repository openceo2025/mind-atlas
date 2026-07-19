# Mind Atlas GitHub Developer Launch

Experiment: `dev_2026w29_01_github`

Destination: https://github.com/openceo2025/mind-atlas

Primary asset:
`docs/media/mind-atlas-agent-notification-loop.mp4`

Static asset:
`docs/images/mind-atlas-github-social-preview.png`

## X post

AI coding agents are fast. Keeping track of parallel runs is not.

I built Mind Atlas: an open-source spatial mission control for Codex, Claude
Code, and OpenClaw.

- agent work becomes navigable branches
- completed runs pulse in the workspace
- context, logs, and work roots stay local
- AGPL-3.0

https://github.com/openceo2025/mind-atlas

## X follow-up

Mind Atlas is not trying to replace the agents. It is the place where their
requests, results, approvals, and project context remain visible after the
terminal scrollback is gone.

Run it locally:

```text
git clone https://github.com/openceo2025/mind-atlas.git
cd mind-atlas
npm install
npm run dev:all
```

## Show HN submission

Title:

`Show HN: Mind Atlas – spatial mission control for Codex, Claude Code and OpenClaw`

URL:

`https://github.com/openceo2025/mind-atlas`

First comment:

I built Mind Atlas because I kept losing the relationship between an AI coding
request, the project context that produced it, and the result I needed to
review later. Terminal tabs and flat chat histories were not enough once I had
several work streams running.

Mind Atlas stores those requests and results as spatial branches. It can run
Codex, Claude Code, and OpenClaw through a local bridge, show completion or
error notifications away from the current focus, preserve logs, and restore
unacknowledged results after a browser or bridge interruption.

The agent controls are deliberately local-only. Work roots, command execution,
provider credentials, and logs are not exposed by the public hosted notebook.

The project is an early TypeScript/React/Three.js prototype under AGPL-3.0. You
can run the notebook without a provider, or connect one of the supported local
agent CLIs. I would especially value feedback on whether the spatial history is
useful after the visual novelty wears off.

## Publication order

1. Confirm the README animation and images render on GitHub.
2. Upload `docs/images/mind-atlas-github-social-preview.png` as the repository
   social preview.
3. Set the repository description, website, and topics.
4. Publish the X post with the MP4 attached.
5. Submit Show HN while the maintainer can answer questions for two hours.
6. Record GitHub Traffic, stars, and clones at 24 hours, 72 hours, and seven
   days.

Do not request coordinated upvotes or stars in the Show HN thread.
