# Setup

Two halves: create the bot in Discord and prepare the channels, then deploy it
on Railway. Do the Discord half first — the deploy needs four IDs that come out
of it.

Assumes you are an admin of the server.

---

## Part 1 — Discord

### 1.1 Turn on Developer Mode

**User Settings → Advanced → Developer Mode.**

This adds "Copy Server ID" / "Copy Channel ID" to right-click menus. You need
four IDs, and this is the only way to get them.

### 1.2 Create the application and bot

1. Go to <https://discord.com/developers/applications> and click **New
   Application**. Name it whatever you want members to see — this becomes the
   bot's display name.
2. Open the **Bot** tab.
3. Click **Reset Token**, then **Copy**. This is `DISCORD_TOKEN`. Paste it
   somewhere safe now; the portal will not show it again.
4. Turn **Public Bot** *off*. Nothing about this bot is multi-server — it reads
   one guild ID from configuration — so there is no reason to let anyone else
   invite it.
5. Leave all three **Privileged Gateway Intents** *off*. The bot never reads
   message content or member lists. Buttons, modals and slash commands all
   arrive as interactions, which need no privileged intent, so there is nothing
   to request and no verification to pass later.

### 1.3 Invite the bot

Still in the developer portal, open **OAuth2 → OAuth2 URL Generator**.

Under **Scopes**, tick:

- `bot`
- `applications.commands`

Under **Bot Permissions**, tick exactly these:

| Permission | Why it is needed |
|---|---|
| View Channels | See the launcher channel and the forum at all |
| Send Messages | Post the launcher panel |
| Embed Links | The event panel is an embed |
| Read Message History | Find its own launcher panel on restart instead of posting a duplicate |
| Create Public Threads | A forum post *is* a thread — this is how events get created |
| Send Messages in Threads | Post promotion, reminder and cancellation notices |
| Manage Threads | Unarchive before editing, apply state tags, lock on cancel |
| Pin Messages | Pin the launcher panel |

Copy the generated URL at the bottom, open it, pick your server, and authorise.

> **Shortcut:** the permission integer for that exact set is
> `2252126231284736`. You can paste it straight into the URL:
> `https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=2252126231284736`
>
> **If "Pin Messages" isn't in your portal's list**, use `326417599488`
> instead. Pinning was split out of Manage Messages in February 2026 and older
> portal UIs may not show it yet. The bot handles this: it logs a warning and
> carries on with the panel unpinned. Everything else works.

### 1.4 Create `#events-launcher`

A normal **text** channel. This is where the "New event" button lives.

Slash commands and buttons need a message composer, and a forum channel's root
has none — so the create trigger cannot live in the forum itself. That is why
there are two channels.

**Who can create events is decided entirely by this channel's permissions.**
The bot performs no role check of its own. If you want events limited to
organisers, deny **View Channel** to `@everyone` here and allow it for the
organiser role. You can change this at any time without redeploying.

Right-click the channel → **Copy Channel ID**. This is `LAUNCHER_CHANNEL_ID`.

### 1.5 Create `#events`

A **Forum** channel. This is where event posts appear.

**Create three tags.** Channel settings → **Tags** → add, spelled exactly:

- `Open`
- `Full`
- `Cancelled`

The bot matches these by name, case-insensitively, and swaps whichever one is
applied as an event fills up or is called off. This is the only state visible in
the forum list without opening a post — thread names can't do the job, because
Discord rate-limits renames to twice per ten minutes.

If a tag is missing the bot logs a warning at startup and simply skips tagging;
everything else still works.

**Lock down post creation.** Channel settings → **Permissions**:

- `@everyone` → **Create Posts**: ❌ deny
- your bot's role → **Create Posts**: ✅ allow

Members can still reply inside threads and use the RSVP buttons. Only the bot
opens posts, which is what makes the forum read as an official list rather than
a free-for-all.

Right-click the channel → **Copy Channel ID**. This is
`EVENTS_FORUM_CHANNEL_ID`.

### 1.6 Copy the server ID

Right-click the server name → **Copy Server ID**. This is `DISCORD_GUILD_ID`.

You should now have four values: the token, the server ID, and two channel IDs.

---

## Part 2 — Railway

### 2.1 Push the code to GitHub

Railway deploys from a repository.

```bash
git init
git add .
git commit -m "Discord event manager"
gh repo create discord-event-manager --private --source=. --push
```

### 2.2 Create the service

1. <https://railway.app> → **New Project** → **Deploy from GitHub repo**.
2. Pick the repository. Railway detects Node from `package.json` and reads
   `railway.json` for the build and start commands, so there is nothing to
   configure here.

Let the first deploy fail. It has no environment variables yet, and the bot
exits immediately with a message naming what is missing. That is by design —
a misconfigured bot should not sit connected and silently broken.

### 2.3 Add the volume — do this before setting variables

**Service → Settings → Volumes → Add Volume.** Set the mount path to:

```
/data
```

**This step is not optional.** Railway containers have an ephemeral filesystem:
without a volume, the SQLite file is wiped on every redeploy and every restart,
and every event and RSVP goes with it. The volume is the only durable storage
the service has.

Two consequences worth knowing:

- A service with a volume deploys by **recreate** — the old container stops
  before the new one starts. Expect a few seconds of downtime per deploy. This
  is correct for SQLite, which allows exactly one writer.
- **Do not scale past one replica.** Two containers cannot share one volume, and
  a second gateway connection would double-handle every click. `railway.json`
  pins `numReplicas` to 1.

### 2.4 Set the variables

**Service → Variables → Raw Editor**, and paste this with your own values:

```
DISCORD_TOKEN=your-token-here
DISCORD_GUILD_ID=000000000000000000
LAUNCHER_CHANNEL_ID=000000000000000000
EVENTS_FORUM_CHANNEL_ID=000000000000000000
DATABASE_PATH=/data/events.db
TZ=Europe/London
REMINDER_LEAD_MINUTES=60
```

Notes:

- **`DATABASE_PATH` must sit inside the volume mount path.** `/data/events.db`
  matches the `/data` mount from the previous step. If these disagree, you get a
  database that quietly disappears on redeploy.
- **`TZ` decides what "Friday 7pm" means.** Hosts type dates as free text and
  the parser resolves them against the process clock, which defaults to UTC.
  Set this to your server's home timezone using an [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)
  (`Europe/London`, `America/New_York`, …). Attendees are unaffected either
  way — times render in each viewer's own local zone.
- `REMINDER_LEAD_MINUTES` is how far ahead the in-thread reminder is posted.

### 2.5 Deploy

Railway redeploys automatically when variables change. Watch **Deployments →
View Logs**. A healthy start looks like:

```json
{"level":"info","message":"database ready","databasePath":"/data/events.db"}
{"level":"info","message":"registered guild commands","guildId":"..."}
{"level":"info","message":"posted launcher panel","messageId":"..."}
{"level":"info","message":"bot ready","user":"Events#1234","timeZone":"Europe/London"}
```

Ignore any Railway prompt about exposing a port or adding a domain. This is a
worker: it makes an outbound gateway connection and listens on nothing.

### 2.6 Check it works

1. Look at `#events-launcher` — the pinned **New event** panel should be there.
2. Click **New event**, fill in the form, submit.
3. A post appears in `#events` tagged `Open`, with the three RSVP buttons.
4. Click **I'm in** — the roster and spot count update.

Set capacity to 1 on a test event and click **I'm in +1** from a second account
to watch the waitlist behave.

---

## Day-to-day use

| Action | How |
|---|---|
| Create an event | **New event** button in `#events-launcher`, or `/event create` |
| Edit an event | `/event edit`, run **inside that event's post** |
| Cancel an event | `/event cancel`, run **inside that event's post** |
| RSVP | The buttons on the event post |

`edit` and `cancel` are run inside the event's own thread because that is how
the bot knows which event you mean — no ID to copy. `edit` is host-only;
`cancel` is host or anyone with **Manage Server**, so an admin can clean up
after a host who has left.

Cancelling notifies everyone who RSVPed (confirmed *and* waitlisted — a queued
member is still holding the evening open), applies the `Cancelled` tag, and
locks the thread.

---

## Troubleshooting

**The bot is online but the launcher panel never appeared.** It cannot see or
post in `#events-launcher`. Check the bot's role has View Channels and Send
Messages there. The logs name the failure.

**Startup log says `could not pin the launcher panel`.** The bot lacks Pin
Messages. Harmless — the panel works unpinned. Grant the permission and restart
if you want it pinned.

**Startup log says `forum is missing event state tags`.** Create the `Open`,
`Full` and `Cancelled` tags on the forum (step 1.5). Events still work; they
just won't show state in the forum list.

**Creating an event fails.** The bot needs **Create Posts** allowed on the forum
for its own role — the same setting you denied to `@everyone` in step 1.5.

**Slash commands don't autocomplete.** They register to the one guild at
startup, which is instant, so this usually means `DISCORD_GUILD_ID` is wrong or
the bot was invited without the `applications.commands` scope. Re-run the invite
URL from step 1.3.

**Everything vanished after a deploy.** No volume, or `DATABASE_PATH` points
outside it. See step 2.3. Past events are unrecoverable, but fixing the mount
prevents a repeat.

**"This interaction failed" on a button.** Check the logs. If the bot was
redeployed mid-click, just click again — the panel is rebuilt from the database,
so nothing is lost.
