# HUNTED BY CLAUDE – Feature Implementation Plan

## Feature 1: Multiple Map Layouts with Difficulty Levels
- [ ] Create 3 difficulty tiers: Easy, Normal, Hard
- [ ] Design 3 unique map layouts (maze-like, open, compact)
- [ ] Implement difficulty selection in lobby
- [ ] Adjust Claude AI aggression by difficulty
- [ ] Vary timer, key placement, and hiding spots by difficulty

## Feature 2: Scoring & Leaderboard System
- [ ] Calculate score: (time_remaining * 10) + (keys_collected * 50) + (difficulty_multiplier)
- [ ] Store scores in JSON file (leaderboard.json)
- [ ] Display top 10 scores after game ends
- [ ] Show personal best and rank
- [ ] Add leaderboard view in lobby

## Feature 3: Environmental Puzzles
- [ ] Combination locks: 3-digit code, Claude taunts about it
- [ ] Pressure switches: activate lights or unlock doors
- [ ] Sequence puzzles: press tiles in correct order
- [ ] Integrate puzzles into map design
- [ ] Claude AI references puzzles in taunts

## Implementation Order
1. Add map layouts to server.js
2. Add difficulty selection to client lobby
3. Implement scoring logic
4. Add leaderboard storage and display
5. Create puzzle system and map integration
6. Test all features
7. Push to GitHub
