# GEMINI.md

Read **[AGENTS.md](./AGENTS.md)** — it holds all rules for this repo and applies to every
agent equally. Nothing Gemini-specific lives here; keeping one canonical file avoids the
two drifting apart.

The rule most likely to be violated: **push code into `src/components/`, not into
individual games.** Adding a game should mean writing game logic and almost nothing else.
