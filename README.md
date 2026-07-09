# 🐐 Mountain Goats — Online Multiplayer Dice Game

Race your herd of goats over five mountains. A live, real‑time board game you can
play with friends on your phones. Built with **Node.js + Express + Socket.IO** and a
premium mobile‑first UI.

---

## ✨ Features
- **Create / Join rooms** with a 4‑letter code from the home page.
- **Type your name** to create or join a game (2–6 players).
- **Everyone's live stats** (mountains conquered + steps climbed) are visible to all players.
- **Premium, mobile‑first UI** — glassmorphism cards, animated dice & goats, clear high‑contrast board.
- Reconnect support (refresh the page and you rejoin automatically).

## 🎲 How to play
Implemented per the official rules (https://www.yucata.de/en/Rules/MountainGoats):
1. **6 mountains** numbered **5–10**. Heights (spaces to the top): 5,6 → 4; 7,8 → 3; 9,10 → 2.
2. Each mountain has a **stack of Point Tokens** worth its number (4p: 12/11/10/9/8/7; −1 each in 3p, −2 each in 2p).
3. You have one 🐐 at the **foot of each** mountain.
4. On your turn, **roll 4 dice**. If you roll more than one **1**, keep one and re‑face the others.
5. **Group** the dice — each group whose **sum is 5–10** moves that mountain's goat **up one space**.
6. Reaching a **top** takes a Point Token and **bumps** the goat already there back to the foot. If your goat is already on top, a matching group **harvests** another token.
7. Collecting a token from **all 6 mountains** (a full set) claims the highest remaining **Bonus Token** (15/12/9/6).
8. **End:** when all Bonus Tokens are claimed **or** 3 mountains are emptied, finish so everyone has **equal turns**.
9. **Most points wins.** Ties: most goats on tops, then a goat on the higher‑numbered mountain. 🏆

---

## 🖥️ Run locally
```bash
npm install
npm start
```
Open http://localhost:3000 on your computer, and on your phone use your computer's
local IP (e.g. `http://192.168.1.5:3000`) while on the same Wi‑Fi.

---

## 🚀 Deploy on Render (free)
1. Push this folder to a GitHub repository.
2. On [render.com](https://render.com) → **New → Web Service** → connect the repo.
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - The included `render.yaml` sets these automatically (Blueprint deploy).
3. Render gives you a public URL (e.g. `https://mountain-goats.onrender.com`).
4. Open it on each player's mobile, create a room, share the code — and climb! 🐐

> Socket.IO works over Render's HTTPS/WebSocket out of the box. The server reads
> `process.env.PORT`, which Render sets automatically.

---

## Database (optional, recommended for Render)

Game history is stored in **PostgreSQL** when `DATABASE_URL` is set (Neon, Supabase,
or Render Postgres). Without it, history is written to `data/game-history.json`,
which **does not survive** Render restarts.

### Free Postgres (Neon example)

1. Create a free project at [neon.tech](https://neon.tech).
2. Copy the **connection string** (starts with `postgresql://`).
3. On Render → your web service → **Environment** → add:
   - `DATABASE_URL` = your connection string
4. Redeploy. The server creates the `game_history` table on first start.

Local dev: copy `.env.example` to `.env` and set `DATABASE_URL`, or omit it to
use the JSON file fallback.

---

## 🗂️ Project structure
```
.
├── server.js            # Express + Socket.IO server, rooms & game logic
├── db.js                # PostgreSQL game history (when DATABASE_URL is set)
├── package.json
├── render.yaml          # Render blueprint
└── public/
    ├── index.html       # Home, lobby, game screens
    ├── css/style.css    # Premium UI
    └── js/main.js       # Client: sockets, rendering, interactions
```

## ⚙️ Tweakables (in `server.js`)
- `WIN_TARGET` — mountains needed to win (default `3`).
- `MAX_PLAYERS` — players per room (default `6`).
- `MOUNTAINS` — names and step counts of each mountain.

