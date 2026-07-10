# 🐐 Mountain Goats — Online Multiplayer Dice Game

Race your herd of goats over five mountains. A live, real‑time board game you can
play with friends on your phones. Built with **Node.js + Express + Socket.IO** and a
premium mobile‑first UI.

---

## ✨ Features
- **Create / Join rooms** with a 4‑letter code from the home page.
- **Sign in with Google** (optional) or **play as guest** with a typed name.
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

### Supabase on Render (important)

Do **not** use the **Direct connection** URL (`db.xxxx.supabase.co:5432`). Render
often cannot reach it over IPv6 (`ENETUNREACH` in logs).

Use the **Session pooler** instead:

1. Supabase Dashboard → **Connect** → **Connection string**
2. Choose **Session pooler** (not Direct)
3. Copy the URI. It looks like:
   ```text
   postgresql://postgres.nqdtoihdqqlombxbvpwb:[PASSWORD]@aws-0-ap-south-1.pooler.supabase.com:5432/postgres
   ```
   Note: username is `postgres.PROJECT_REF`, host ends with `.pooler.supabase.com`
4. URL-encode special characters in the password (`@` → `%40`)
5. Set as `DATABASE_URL` on Render and redeploy

Success logs:
```text
[db] Schema ready
[history] Loaded 0 game(s) from database
Mountain Goats running on ... (history: PostgreSQL)
```

Local dev: copy `.env.example` to `.env` and set `DATABASE_URL`, or omit it to
use the JSON file fallback.

---

## Google Sign-In (optional)

Optional **Sign in with Google** via **Supabase Auth**. Signed-in players choose a
custom GOAT name that syncs across devices. Guests can still type a name.

**How names are stored:**

- **Cross-device autofill:** Supabase Auth `user_metadata.gaming_name` (client)
- **Server gameplay / reconnect:** `users.gaming_name` in Postgres (written on create/join)
- **Google profile audit:** `users.google_name` and `users.avatar_url` on sign-in
- **Match stats (signed-in only):** `users.matches_played`, `matches_won`, `matches_lost`, plus Standard/Team breakdown, win streaks, and profile drawer on the home screen — updated when a game finishes naturally; win count shown on the end scorecard when you win

### 1. Supabase

1. **Authentication → Providers → Google** — enable; add OAuth client ID/secret from Google Cloud (Web application).
2. **Authentication → URL Configuration**
   - Site URL: `https://your-app.onrender.com`
   - Redirect URLs: `https://your-app.onrender.com`, `http://localhost:3000`
3. **Project Settings → API** — copy Project URL, anon key, and JWT Secret.

### 2. Google Cloud Console

1. Create an OAuth 2.0 **Web application** client.
2. **Authorized JavaScript origins:** your Render URL and `http://localhost:3000`
3. **Authorized redirect URI:** Supabase callback (shown in Supabase Google provider settings), e.g. `https://xxxx.supabase.co/auth/v1/callback`

### 3. Render environment variables

| Key | Purpose |
|-----|---------|
| `SUPABASE_URL` | Project URL (required on server for socket token verification) |
| `SUPABASE_ANON_KEY` | Public anon key (required on server for token verification) |
| `SUPABASE_JWT_SECRET` | Optional legacy fallback for local JWT verification |
| `DATABASE_URL` | Session pooler URL (creates `users` + `game_history` tables) |

Redeploy after adding env vars. The Google button appears on the home screen when
`SUPABASE_URL` and `SUPABASE_ANON_KEY` are set.

After sign-in, enter your GOAT name and create or join a room once. The name is
saved to your Google account and autofills on other browsers and devices.

**Rejoin after refresh:** guests use `mg_name` + `mg_code` in localStorage;
signed-in users rejoin with `mg_code` and their name from Supabase Auth metadata.

---

## 🗂️ Project structure
```
.
├── server.js            # Express + Socket.IO server, rooms & game logic
├── auth.js              # Supabase JWT verification
├── db.js                # PostgreSQL (game_history, users)
├── package.json
├── render.yaml          # Render blueprint
└── public/
    ├── index.html       # Home, lobby, game screens
    ├── css/style.css    # Premium UI
    └── js/
        ├── auth.js      # Supabase client, Google sign-in
        └── main.js      # Client: sockets, rendering, interactions
```

## ⚙️ Tweakables (in `server.js`)
- `WIN_TARGET` — mountains needed to win (default `3`).
- `MAX_PLAYERS` — players per room (default `6`).
- `MOUNTAINS` — names and step counts of each mountain.

