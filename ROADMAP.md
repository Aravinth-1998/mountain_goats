# Mountain Goats — Later / Roadmap

Items deferred from the public/strangers track. Deep-link join (`/?code=1234`) is already shipped; the list below is what comes next.

## Public discovery

### Quick Match (next)
- Add a **Quick Match** control on home (same name gate as Join).
- Flow:
  1. Call `getPublicRooms`.
  2. Join the first non-full, not-started public lobby.
  3. If none exist, create a room with `isPublic: true` and open the lobby.
- Handle errors (full/race, create failure) with a clear toast/message.

### Default public + create prompt
- Prefer new rooms starting as **Public**, or ask on create (Private / Public).
- Keep host ability to switch visibility in lobby.

### Public room list quality
- Richer cards: mode, seats left, maybe wait age / “looking for players”.
- Optional mode filter (Standard / Team).
- Reliable idle / empty lobby cleanup so the list stays trustworthy.
- Avoid listing host-only lobbies that never get a second player for a long time (policy TBD).

## After public basics

- First-time onboarding nudge for strangers (short How to Play / tutorial CTA before first public game).
- Soft matchmaking preferences later (team vs standard) if Quick Match grows.
- Abuse / AFK host handling for public lobbies (kick / transfer host / auto-close).

## Notes

- Invite deep links: `/?code=NNNN` (also `?join=`) — Join screen prefilled; lobby Share copies the URL.
- Public rooms listing ack fix (`safeHandler` + `getPublicRooms` payload) is already in place; keep that regression test green when touching socket handlers.
