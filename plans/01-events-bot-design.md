# Discord events bot — design decisions

Spec for a TypeScript Discord bot that posts events to a forum channel with
RSVP buttons, plus-one support, capacity, and a waitlist. This is the decision
record; the implementation follows from it.

Stack: discord.js 14.27+, TypeScript, SQLite. Node 24.17+.

---

## 1. Ownership of the event post

**Decision: the bot creates the forum post, not the host.**

Considered having the host create the post and the bot reply beneath it, but a
bot can only edit its own messages. A host-authored starter message can never
carry buttons or live counts, forcing the RSVP panel into a separate reply that
scrolls away as people comment.

With the bot as author, everything lives on the starter message: description,
counts, roster, buttons. Nothing to pin, nothing to scroll past.

Cost: the host composes in a modal rather than the normal message box — no image
pasting, no rich composer. Accepted.

## 2. Invoking the create form

Modals can only open as the immediate response to another interaction. Two
triggers, both reaching the same handler:

- **Primary: a persistent "New event" button** on one pinned bot message in the
  staff channel. One click, no syntax to remember, discoverable for other
  organizers.
- **Backup: `/event create`** with zero options, so the modal opens immediately.

Note: slash commands cannot be used at a forum channel's root — there is no
composer there. Both triggers live in a regular text channel; the bot posts into
the forum.

## 3. The modal

Five top-level components, which is the hard cap:

| Field | Type | Notes |
|---|---|---|
| Title | text input | max 90 chars, becomes the thread name |
| Date/time | text input | free text, parsed with chrono |
| Description | paragraph input | up to 4000 chars |
| Location | text input | optional |
| Capacity | text input | total headcount, integer |

**Same modal for create and edit.** The edit path prefills via `setValue` from
the DB and is gated on `interaction.user.id === ev.host_id`. Build the form once
and reuse it, or the two will drift.

**Capacity is a text input, not a select.** Selects would make validation
structurally impossible, but the values would have to be presets. Arbitrary
numbers are worth the parsing.

**Validation recovery:** you cannot respond to a modal submit with another
modal. On a bad capacity or unparseable date, reply ephemerally with a "Fix it"
button that reopens the modal prefilled with what they submitted.

**Timezone:** chrono parses relative to the process timezone. Set `TZ` in the
environment. Render with `<t:unix:F>` so each viewer sees their own local time.

## 4. Guests and capacity

**Max one guest per member, always.** Not configurable per event, so no guest
count in the modal and no select menu on the panel — three plain buttons suffice.

**Capacity is total headcount, not a separate guest pool.** One number. Guests
count against it identically to members:

```
taken     = confirmed_members + confirmed_guests
remaining = capacity - taken
```

Rejected the separate-pool alternative: it can block a member from bringing
someone while seats sit empty, which is hard to explain in a footer.

**Delta, not recount.** A confirmed solo member clicking "+1" needs *one* more
seat, not two. Compute the change the click implies and check that against
`remaining`. Recomputing from scratch is the easy bug here.

**Rejected upgrades leave the existing RSVP alone.** One seat left, someone
clicks "I'm in +1" → ephemeral rejection ("only 1 spot left — RSVP solo
instead?"), their solo seat untouched. Never silently seat them alone; a person
who thinks they got a +1 will show up with a person.

**Do not queue a pending guest.** If a confirmed member's "+1" doesn't fit, it's
simply rejected. Queuing it would require a third state — confirmed member with
a waitlisted guest — that infects every count.

## 5. Waitlist

**Status field on the rsvp row:** `confirmed` | `waitlist`. Ordered by the
existing `created_at`.

**One `reconcile(eventId)` function, called after every mutation** — RSVP,
withdraw, capacity edit. It promotes from the head of the queue while the next
entry fits. Every handler becomes: write the change → reconcile → re-render.
Self-healing, and capacity edits need no special-casing.

**Strict FIFO.** No best-fit skipping. A waitlisted +1 blocking a single open
seat unblocks by their own choice: they click "I'm in" while queued, drop to
solo, and reconcile seats them immediately. No timers, no skip logic. The
ephemeral confirmation when joining the waitlist with a guest should mention
that solo spots may open sooner.

**`created_at` never changes on promotion.** A promoted member keeps their
original join time, so withdrawing and rejoining correctly sends them to the
back.

**Withdrawal clears either status.** "Can't make it" works the same whether
you're confirmed or queued. No extra button.

**Promotion notifications post in-thread, mentioning the user.** Not DMs — bot
DMs fail silently for anyone with DMs closed, with no reliable way to detect it.
In-thread also lets the host see it.

## 6. Lowering capacity

**Confirmed attendees are grandfathered in.** This requires no special code:
capacity is never enforced retroactively, it only gates the promotion loop in
`reconcile`. Drop capacity below the confirmed count and `remaining` goes
negative, nothing gets promoted, and the confirmed list is untouched.

Render the overage plainly — "22 of 18 spots taken" — so the host notices.

## 7. The panel

One embed on the starter message, fields in this order:

1. **When** — `<t:unix:F> (<t:unix:R>)`
2. **Where** — omitted if empty
3. **Going** — `<@id>` per line, `**+1**` suffix for guests
4. **Spots** — "12 of 20 spots taken"
5. **Waitlist** — numbered list, `1. <@id> **+1**`

The spots line sits between the two rosters so the capacity state explains why
the second list exists.

**The waitlist is a plain numbered list**, so position is just the index. Nothing
to store, nothing to drift, renumbers itself on every re-render.

**Hide the waitlist field entirely when empty.** A visible empty waitlist on a
half-full event reads like the event is full.

**Truncation is asymmetric.** Fields cap at 1024 chars — roughly 40 mentions.
Truncate the going list first and keep the waitlist whole: a truncated going
list is cosmetic, but a truncated waitlist means someone can't see their own
position, which is the whole point of numbering it. Also watch the 6000-char
total embed budget, which the description eats into.

### Buttons

Three, on the starter message:

- **I'm in** — Success
- **I'm in +1** — Success
- **Can't make it** — Secondary

Buttons stay enabled when full; clicks get an ephemeral "this event is full —
you've been added to the waitlist at #4." Disabling at capacity was considered
and rejected as cosmetics: a stale client can still show enabled buttons, so the
server-side check is required regardless.

Custom IDs are versioned (`rsvp:v1:*`). Bump to `v2` on a semantic change and
keep the `v1` handler so existing posts don't break.

## 8. Forum channel

**Permissions make it "official":** deny `Create Posts` to `@everyone` in the
forum, allow it for the bot's role. Members still reply in threads and use
buttons; only the bot opens posts.

**Forum tags carry state in the list view** — `Open` / `Full` / `Cancelled`, set
via `setAppliedTags`. This is the only signal visible without opening the post.

**Do not rename threads to show counts.** Thread renames are rate-limited to
2 per 10 minutes, which is unusable for live counts. Tags are not rate-limited
this way.

## 9. Implementation invariants

- **State lives in SQLite, never in the rendered message.** Scraping mentions out
  of an embed breaks the first time the layout changes.
- **Every mutation runs inside a per-message lock.** Capacity checks, promotion,
  and re-render are one critical section. Two people taking the last seat
  simultaneously is the failure this prevents.
- **Acknowledge within 3 seconds.** `deferUpdate()` first, then DB work. Modals
  are the exception — they cannot be deferred and must be the first response.
- **Unarchive before editing.** Editing a message in an archived thread fails.
  Forum posts auto-archive; set the 1-week max and unarchive in the handler.
- **Edit rate limits** bite around 5 edits / 5s per channel. Normal RSVP traffic
  is fine; if bursts appear, coalesce re-renders behind a ~1.5s trailing debounce
  per message rather than editing on every click.
- **Intents:** `Guilds` only. No privileged intents.
- **Bot permissions:** View Channels, Send Messages, Send Messages in Threads,
  Create Public Threads, Manage Threads, Embed Links, Read Message History, and
  `Pin Messages` if pinning anything (split out of Manage Messages in Feb 2026).

## 10. Schema sketch

```sql
CREATE TABLE events (
  message_id  TEXT PRIMARY KEY,   -- starter message; == thread_id for forum posts
  thread_id   TEXT NOT NULL,
  guild_id    TEXT NOT NULL,
  host_id     TEXT NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  location    TEXT,
  starts_at   INTEGER NOT NULL,   -- unix seconds
  capacity    INTEGER NOT NULL,
  cancelled   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE rsvps (
  message_id TEXT    NOT NULL,
  user_id    TEXT    NOT NULL,
  plus_one   INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL,    -- 'confirmed' | 'waitlist'
  created_at INTEGER NOT NULL,    -- never updated on promotion
  PRIMARY KEY (message_id, user_id)
);
```

## 11. Deferred

Not in scope now, additive later:

- `/event cancel` — set the flag, apply the `Cancelled` tag, lock the thread,
  ping the confirmed list.
- Reminder job — cron over `starts_at BETWEEN now AND now + 1h`, post in-thread
  mentioning confirmed attendees.
- Mirror to a native Discord Scheduled Event (`guild.scheduledEvents.create`) so
  events appear in the server's Events tab with real notifications. The forum
  post stays the RSVP surface; the scheduled event is discovery only.
- Per-event guest limits above 1 — would reintroduce a select menu on the panel.
