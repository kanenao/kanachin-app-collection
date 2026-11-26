-- Optional D1 schema for official gift events only. No chat or sender data.
CREATE TABLE IF NOT EXISTS kick_gift_events (
 event_id TEXT PRIMARY KEY,
 broadcaster_id INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('kicks.gifted','channel.subscription.gifts')),
 occurred_at INTEGER NOT NULL,
 amount INTEGER NOT NULL CHECK(amount > 0)
);
CREATE INDEX IF NOT EXISTS kick_gift_time_idx ON kick_gift_events(occurred_at);
CREATE INDEX IF NOT EXISTS kick_gift_channel_idx ON kick_gift_events(broadcaster_id, occurred_at, kind);
