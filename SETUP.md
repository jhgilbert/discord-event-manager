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
| View Channels | See the event builder channel and the forum at all |
| Send Messages | Post the New event panel |
| Embed Links | The event panel is an embed |
| Read Message History | Find its own New event panel on restart instead of posting a duplicate |
| Create Public Threads | A forum post *is* a thread — this is how events get created |
| Send Messages in Threads | Post promotion, reminder and cancellation notices |
| Manage Threads | Unarchive before editing, apply state tags, lock on cancel and once an event is past, delete on `/event delete` |
| Pin Messages | Pin the New event panel |

Copy the generated URL at the bottom, open it, pick your server, and authorise.

**These are a ceiling, not a guarantee.** They apply server-wide, but any
channel that overrides them wins — including for the bot. If either channel is
private, the bot needs an explicit allow on that channel as well. See step 1.5.

> **Shortcut:** the permission integer for that exact set is
> `2252126231284736`. You can paste it straight into the URL:
> `https://discord.com/api/oauth2/authorize?client_id=YOUR_APP_ID&scope=bot%20applications.commands&permissions=2252126231284736`
>
> **If "Pin Messages" isn't in your portal's list**, use `326417599488`
> instead. Pinning was split out of Manage Messages in February 2026 and older
> portal UIs may not show it yet. The bot handles this: it logs a warning and
> carries on with the panel unpinned. Everything else works.

### 1.4 Create `#event-builder`

A normal **text** channel. This is where the "New event" button lives.

Slash commands and buttons need a message composer, and a forum channel's root
has none — so the create trigger cannot live in the forum itself. That is why
there are two channels.

**Who can create events is decided entirely by this channel's permissions.**
The bot performs no role check of its own. If you want events limited to
organisers, deny **View Channel** to `@everyone` here and allow it for the
organiser role. You can change this at any time without redeploying. If you do
make it private, the bot needs a **View Channel** allow of its own here too —
same reasoning as the forum in step 1.5.

Right-click the channel → **Copy Channel ID**. This is `EVENT_BUILDER_CHANNEL_ID`.

### 1.5 Create `#events`

A **Forum** channel. This is where event posts appear.

**Create three tags.** Channel settings → **Tags** → add, spelled exactly:

- `Open`
- `Full`
- `Canceled`

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

**If the forum is private, add the bot explicitly.** A private channel denies
**View Channel** to `@everyone`, and the bot's role is not exempt from that — a
channel overwrite beats the server-wide permissions from the invite URL. Without
an allow here the bot cannot see the forum at all, and it exits at startup
rather than running half-broken.

In **Permissions → Roles/Members**, add your bot's role (Discord creates one
automatically, named after the application) and allow:

| Permission | Without it |
|---|---|
| View Channel | Startup fails — nothing works |
| Create Posts | Events can't be published |
| Send Messages in Posts | No promotion, reminder or cancellation notices |
| Embed Links | The event panel renders empty |
| Read Message History | The panel can't be re-read, so RSVPs don't update |
| Manage Threads | No state tags, no unarchive-before-edit, no lock on cancel or past events, no `/event delete` |

You can add the bot user directly instead of its role; both work. Adding the
role is easier to audit later.

**Keep `#event-builder` no wider than `#events`.** Anyone who can see the event
builder channel can create an event, and the bot replies with a link to the new
post. If someone can reach the builder but not the forum, they get a link that
leads nowhere and an event they can't manage. Restricting the forum is a good
reason to restrict the builder to the same roles — or a subset.

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
EVENT_BUILDER_CHANNEL_ID=000000000000000000
EVENTS_FORUM_CHANNEL_ID=000000000000000000
DATABASE_PATH=/data/events.db
TZ=America/Chicago
REMINDER_LEAD_MINUTES=1440
```

Notes:

- **`DATABASE_PATH` must sit inside the volume mount path.** `/data/events.db`
  matches the `/data` mount from the previous step. If these disagree, you get a
  database that quietly disappears on redeploy.
- **`TZ` decides what "Friday 7pm" means.** Hosts type dates as free text and
  the parser resolves them against the process clock, which defaults to UTC.
  Set this to the zone your hosts think in when they type, using an
  [IANA name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones) —
  `America/Chicago` for US Central, `America/New_York`, `Europe/London`, and so
  on. Use the region name, never an abbreviation like `CST` or a fixed offset:
  the IANA zone carries the daylight-saving rules with it, so an event typed in
  November lands correctly without anyone adjusting anything twice a year.
  Inside a post, times render in each viewer's own local zone, so someone
  travelling sees their current local time. The one exception is the post's
  *name* — `Board game night (Friday, Aug 7 at 6:30 PM)` — which is plain text
  and so is always written in `TZ`. That is worth knowing only if your members
  are spread across zones; if they are, the name is the one place they should
  not trust.
- **`REMINDER_LEAD_MINUTES` is how far ahead the in-thread reminder is posted.**
  `1440` is the day before; `60` is an hour before. Anything from 1 minute to
  10080 (a week) is accepted, and changing it takes effect on the next deploy
  with no migration — the value is read at sweep time, not stored per event.
  Confirmed attendees are pinged; the waitlist is not.

  Events created *inside* the window — posted for tonight when the lead is a
  day — get no reminder, deliberately. The post itself is the notice, and a
  reminder minutes after the announcement would reach only whoever RSVPed in
  the first sixty seconds. The log says `skipping reminder for short-notice
  event` when this happens.

### 2.5 Deploy

Railway redeploys automatically when variables change. Watch **Deployments →
View Logs**. A healthy start looks like:

```json
{"level":"info","message":"database ready","databasePath":"/data/events.db"}
{"level":"info","message":"registered guild commands","guildId":"..."}
{"level":"info","message":"posted new event panel","messageId":"..."}
{"level":"info","message":"bot ready","user":"Events#1234","timeZone":"America/Chicago"}
```

Ignore any Railway prompt about exposing a port or adding a domain. This is a
worker: it makes an outbound gateway connection and listens on nothing.

### 2.6 Check it works

1. Look at `#event-builder` — the pinned **New event** panel should be there.
2. Click **New event**, fill in the form, submit.
3. A post appears in `#events` tagged `Open`, with the three RSVP buttons. You
   are already on the **Going** list: hosts are RSVPed to their own event
   automatically, and take a spot like anyone else.
4. Click **RSVP** from a second account — the roster and spot count update.

**RSVP +1** starts greyed out — tap **+1 settings** on the reply you got when
creating the event, and choose *Allowed on or after a date* with the date left
blank. Then set capacity to 2 on a test event and click **RSVP +1** from that
second account to watch the waitlist behave: one spot is yours, so a member bringing a
guest needs two and waits for them.

---

## Day-to-day use

| Action | How |
|---|---|
| Create an event | **New event** button in `#event-builder`, or `/event create` |
| Edit an event | `/event edit`, run **inside that event's post** |
| Cancel an event | `/event cancel`, run **inside that event's post** |
| Delete an event | `/event delete`, run **inside that event's post** — admins only |
| Hold a seat for someone not on Discord | `/event reserve-seat for: Levi`, run **inside that event's post** |
| Give that seat back | `/event release-seat for: Levi` — the name autocompletes |
| Refresh names on a post | `/event reload`, run **inside that event's post** — admins only |
| RSVP | The buttons on the event post |
| Allow +1s | **+1 settings** on the reply to create, or to `/event edit` |
| Drop out as host | **Cancel RSVP** on your own post — the event stays up, your spot is freed |

`edit` and `cancel` are run inside the event's own thread because that is how
the bot knows which event you mean — no ID to copy.

Who can do what:

| | Host | **Manage Server** | **Administrator** | Everyone else |
|---|---|---|---|---|
| Edit | ✅ | ✅ | ✅ | — |
| Cancel | ✅ | ✅ | ✅ | — |
| Delete | — | — | ✅ | — |
| Reserve / release a seat | ✅ | ✅ | ✅ | — |
| Reload | — | — | ✅ | — |

Administrators hold every permission in Discord, so they pass the Manage Server
checks too. A server manager can fix or call off an event whose host has gone
quiet or left, but only an administrator can erase one — cancelling is
recoverable and tells everyone, deleting is neither.

A reserved seat is treated like anyone's RSVP: it takes a seat if there is
room, and goes on the waitlist (in order, behind whoever is already waiting) if
there is not. To squeeze someone in regardless, raise the spots with
`/event edit` first. Names are unique per event, ignoring capitals — a second
Levi needs an initial. Each reserve and release is noted in the thread, without
pinging anyone, so the waitlist can see why the count moved. Whoever reserved
the seat is the one pinged about it later, since Levi has no Discord account to
ping. If the host drops out, their reserved seats stay.

`reload` looks up everyone on the post again and redraws it, which replaces
any leftover user IDs and picks up changed nicknames. It is never needed for the
post to work, so it is kept for administrators rather than every host. On a canceled
or past post the bot reopens it to redraw and then locks and closes it again;
administrators can run commands in a locked post.

**Every edit posts what changed, in the event's own thread** — including the
host's own edits, and including a change made by an admin. The notice names who
made it and lists the fields, old value then new:

> **@jen** updated this event:
> · **When** — Friday, August 7, 2026 6:30 PM → **Saturday, August 8, 2026 7:00 PM**
> · **Where** — My place → **The park**

**Whether anyone is pinged depends on what changed.** A new time or a new place
mentions everyone RSVPed, seated and waitlisted, because it might stop them
coming. A fixed typo, a reworded description or a capacity change posts the
notice without mentioning anyone — the record is there to read, but nobody's
phone lights up. Whoever made the edit is never pinged by it.

Edits are also logged as `event updated` with `editedBy`, `hostId` and the list
of changed fields.

Cancelling notifies everyone who RSVPed (confirmed *and* waitlisted — a queued
member is still holding the evening open), applies the `Canceled` tag, and
locks the thread.

Past events need nothing from the host. Once a day the bot locks and closes
every post whose day is over, so it moves to the forum's *Older Posts* — still
there to scroll back to, but out of the main list. The RSVP buttons, `edit` and
`cancel` all stop working on it.

**Cancel and delete are different tools.** Cancel is the one to reach for
normally: it tells everyone, and the post stays as a record. Delete is for
mistakes and spam — a duplicate post, a test event, something that should never
have been there. It erases the post, every reply in it and every RSVP, tells
nobody, and cannot be undone, so it is restricted to **Administrator** rather
than the Manage Server permission that cancelling accepts. It asks for
confirmation first and names what will be lost.

---

## Troubleshooting

**The build fails with `EBUSY: resource busy or locked, rmdir
'/app/node_modules/.cache'`.** Something is running `npm ci` during the *build*
phase. Nixpacks already installs dependencies in its own earlier phase, and it
mounts a build cache at `node_modules/.cache`; `npm ci` starts by deleting
`node_modules` wholesale, and it cannot delete a live mount point. The build
command in `railway.json` is therefore `npm run build` alone — no install step.
If you add one back, use `npm install`, which updates in place rather than
wiping the directory first.

**The bot is online but the New event panel never appeared.** It cannot see or
post in `#event-builder`. Check the bot's role has View Channels and Send
Messages there. The logs name the failure.

**The bot exits at startup saying a channel was not found, or the log shows
`Missing Access` / `50001`.** Almost always a private channel the bot has not
been added to, rather than a wrong ID — from the bot's side the two are
indistinguishable, because Discord hides channels it can't see instead of
refusing them. Add the bot's role to that channel's permissions (step 1.5). If
the channel isn't private, re-copy the ID with Developer Mode on.

**Startup log says `could not pin the new event panel`.** The bot lacks Pin
Messages. Harmless — the panel works unpinned. Grant the permission and restart
if you want it pinned.

**Startup log says `forum is missing event state tags`.** Create the `Open`,
`Full` and `Canceled` tags on the forum (step 1.5). Events still work; they
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
