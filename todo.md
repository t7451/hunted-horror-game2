# HUNTED Horror Game - Final Refinement TODO

## Phase 1: Audit (Complete)
- [x] Server.js: 589 lines, session-based multiplayer, Granny AI with patrol/investigate/chase
- [x] Client index.html: ~1078 lines, Three.js r128, mobile controls, minimap
- [x] Known issues:
  - Environment too dark (fog 0.015 still may be too dense for r128)
  - Materials use MeshLambertMaterial (low quality)
  - Entity model is basic boxes
  - No Claude AI integration
  - No dynamic villain dialogue/taunts
  - Lobby title says "HUNTED" not "HUNTED by CLAUDE"

## Phase 2: Server Rewrite with Claude AI
- [ ] Install anthropic SDK
- [ ] Add Claude AI endpoint for villain taunts/dialogue
- [ ] Claude AI decides hunting strategy based on game state
- [ ] Broadcast Claude's taunts to players
- [ ] Enhanced AI state machine informed by Claude's decisions

## Phase 3: Client Visual Overhaul
- [ ] Brighter materials (MeshPhongMaterial)
- [ ] Better fog settings
- [ ] Claude villain model with cyan/orange theme
- [ ] AI dialogue overlay (shows Claude's taunts)
- [ ] Enhanced lobby with Claude branding
- [ ] Sound effects for Claude's presence
- [ ] Flickering lights in corridors

## Phase 4: Testing
- [ ] Verify lobby -> game transition
- [ ] Verify 3D rendering is visible
- [ ] Verify Claude AI taunts appear
- [ ] Verify mobile controls work
