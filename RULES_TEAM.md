# Mountain Goats Team Play Variant (v1.1)

## Overview

This variant introduces team-based gameplay while preserving all original Mountain Goats movement, dice, mountain, and end-game rules.

Teams can be split into **2 or 3 teams**, as long as all teams have **equal numbers of players**. The host can switch between 2-team and 3-team layouts in the lobby.

Supported team configurations:

| Players | 2 Teams | 3 Teams |
|---------|---------|---------|
| 2       | 1v1 ✅  | —       |
| 3       | —       | 1v1v1 ✅ |
| 4       | 2v2 ✅  | —       |
| 5       | —       | —       |
| 6       | 3v3 ✅  | 2v2v2 ✅ |
| 7       | —       | —       |
| 8       | 4v4 ✅  | —       |
| 9       | —       | 3v3v3 ✅ |
| 10      | 5v5 ✅  | —       |

> **Note:** 5-player and 7-player games cannot use team mode (no even split is possible with 2 or 3 teams).

All standard rules apply unless explicitly modified below.

> **Token counts:** The same player-scaling rule from standard mode applies. For **2–3 players**, remove `4 - numPlayers` tokens from each mountain's full stack. For **4+ players**, use the full stacks (Mountain 5 → 12, Mountain 6 → 11, Mountain 7 → 10, Mountain 8 → 9, Mountain 9 → 8, Mountain 10 → 7).

---

## Team Setup

### Team Assignment

Players are assigned to teams in round-robin order. The host can manually move players between teams in the lobby before starting.

Examples:

### 2 Teams of 2 (4 Players)
- Team Red: Player A + Player C
- Team Blue: Player B + Player D

### 2 Teams of 3 (6 Players)
- Team Red: Player A + Player C + Player E
- Team Blue: Player B + Player D + Player F

### 3 Teams of 2 (6 Players)
- Team Red: Player A + Player D
- Team Blue: Player B + Player E
- Team Green: Player C + Player F

Each player continues to control their own goats.

---

## Turn Order

Turns **alternate between teams** in a round-robin fashion (Red → Blue → Red → Blue…, or Red → Blue → Green → Red… for 3 teams).

Within each team, members take turns in order. This interleaving ensures no team plays consecutive turns.

**Example (2 Teams of 2):**
1. Team Red — Player A
2. Team Blue — Player B
3. Team Red — Player C
4. Team Blue — Player D
5. Team Red — Player A _(cycle repeats)_

---

## Individual Token Collection

Each player **collects their own tokens independently**. When your goat reaches a summit, **you** take a point token — even if a teammate's goat is already on that summit.

- Each point token is worth the value of its mountain (5, 6, 7, 8, 9, or 10 points).
- Each player tracks their own collected tokens and bonus progress.

---

## Team Score

A team's score is the **combined total** of all its members' individual scores (point tokens + bonus tokens).

The team with the highest combined score wins.

---

## Bonus Tokens

Bonus tokens work the same as in standard mode — they are earned **individually** by each player. When a player collects at least one token from each of the six mountains (a full set), they claim the next available bonus token (15/12/9/6).

A player's bonus points are added to their team's combined score.

---

## Team Summit Occupancy

Teammates **may share the same summit**. There is no bumping between teammates.

Examples:

### Team of 2
Mountain 5 Summit:
- Player A goat ✅
- Player B goat ✅

### Team of 3
Mountain 5 Summit:
- Player A goat ✅
- Player B goat ✅
- Player C goat ✅

All teammates may occupy the summit simultaneously. Each teammate that reaches the summit individually collects a token.

---

## Team Summit Conquest (Team Wipeout)

If a player reaches a summit occupied by an **opposing team**:

1. **All** opposing-team goats occupying that summit are immediately removed.
2. Removed goats are returned to the **base** of that mountain.
3. The attacking goat takes control of the summit and collects a token.

### Example

Before:
- Team Red has two goats on the summit of Mountain 7.

Blue Player reaches the summit.

After:
- Both Red goats are returned to the base of Mountain 7.
- Blue Player's goat occupies the summit.
- Blue Player collects a Mountain 7 token (7 points added to Team Blue's score).

This is referred to as a **Team Wipeout**.

---

## Winning

The team with the **highest combined score** wins.

### Tie-breaking

Ties are broken in order:
1. **Most summit positions** held by the team (total across all members)
2. **Highest summit value** among those positions

---

## Strategic Options

Teams may choose to:

### Stack
Place multiple teammates on the same summit for stronger positional control — opponents must wipe all of them in a single climb.

### Spread
Control multiple summits simultaneously using different team members to maximise token collection.

### Coordinate Sets
Focus different teammates on different mountains to collectively complete bonus sets faster.

All strategies are valid and supported by the rules.

---

## Team Variant Summary

1. Players are divided into teams (2 or 3 teams).
2. Turns alternate between teams in round-robin order.
3. Each player collects their own tokens; a team's score is the combined total.
4. Teammates may share summits — no bumping between teammates.
5. Each teammate reaching a summit collects a token individually.
6. If an opposing player reaches a team-held summit, **all** teammate goats there are bumped back to base (Team Wipeout).
7. Bonus tokens are earned individually and count toward the team score.
8. Team with the highest combined score wins; ties broken by summits held, then highest summit value.
9. All other Mountain Goats rules remain unchanged.
