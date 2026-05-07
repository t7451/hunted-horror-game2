# HUNTED BY CLAUDE

A browser-first horror escape game built with React, Three.js, and an Express/WebSocket backend.

## Smart AI Mechanics

The client includes a local AI director in `client/src/game/aiDirector.ts`. It uses deterministic, open-source-friendly game-state heuristics instead of a paid cloud API, so the mechanics work offline and on static deployments.

The director listens to gameplay triggers such as game start, key pickup, hiding, danger changes, and timer pressure. Each trigger updates:

- adaptive enemy pursuit speed;
- tension scoring shown in the HUD;
- contextual story and survival hints.

This provides a foundation for future integration with optional free/open-source model backends while preserving a safe fallback when no AI service is configured.

## Validation

Use `pnpm run check` for TypeScript validation and `pnpm run build` for production builds.
