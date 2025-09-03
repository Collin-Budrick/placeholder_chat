# Cap'n Proto schema for chat messages and control events.
#
# Versioning policy:
# - Never reuse field IDs.
# - Only append new fields.
# - Reserve removed fields by commenting them in the README (see ../README.md).
# - Keep messages small and avoid deep nesting for best perf.
#
# Envelope is the canonical on-wire unit used by RPC and PUB/SUB.
# id: 16-byte ULID binary (Data)
# seq: server-assigned monotonic u64 per-room for gap detection
# serverTs: server ingest timestamp in ms since epoch
#
@0xbf2b3c6a9a1d2f6b;

struct ChatMsg {
  idText @0 :Text;   # optional convenience human-readable id (string form of ULID)
  text   @1 :Text;
  kind   @2 :UInt8;  # enums (0=chat,1=system,...) - keep small
  user   @3 :Text;
  # future fields start at @4
}

struct Join {
  user @0 :Text;
  # future fields start at @1
}

struct Typing {
  user @0 :Text;
  on   @1 :Bool;
  # future fields start at @2
}

struct Read {
  user @0 :Text;
  msg  @1 :Data;    # opaque message id
  ts   @2 :Int64;   # client timestamp or ack time
  # future fields start at @3
}

struct Envelope {
  id       @0 :Data;    # 16 bytes ULID (binary)
  seq      @1 :UInt64;  # server-assigned monotonic sequence per-room
  room     @2 :Text;
  serverTs @3 :Int64;   # ms since epoch assigned at ingest
  union {
    chat   @4 :ChatMsg;
    join   @5 :Join;
    typing @6 :Typing;
    read   @7 :Read;
    # Add new kinds here with new field ids
  }
  # Reserve space for future top-level fields. Do not reuse any field IDs.
}
