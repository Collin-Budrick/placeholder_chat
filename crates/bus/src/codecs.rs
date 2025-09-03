use anyhow::Result;
use std::io::Cursor;

use capnp::message::{Builder, ReaderOptions};
use capnp::serialize_packed;
use proto::message_capnp as message_capnp;

/// Encode a Cap'n Proto Envelope by letting the caller fill the Builder root.
/// Returns a Vec<u8> containing the packed Cap'n Proto message.
pub fn encode_envelope<F>(fill: F) -> Result<Vec<u8>>
where
    F: FnOnce(&mut message_capnp::envelope::Builder),
{
    let mut message = Builder::new_default();
    {
        let mut env = message.init_root::<message_capnp::envelope::Builder>();
        fill(&mut env);
    }

    let mut buf: Vec<u8> = Vec::new();
    // write packed for smaller wire size
    serialize_packed::write_message(&mut buf, &message)?;
    Ok(buf)
}

/// Decode a packed Cap'n Proto message from bytes and return the message reader.
/// Callers can use `msg_reader.get_root::<message_capnp::envelope::Reader>()` to access the Envelope.
pub fn decode_message(bytes: &[u8]) -> Result<capnp::message::Reader<capnp::serialize::OwnedSegments>> {
    let mut cursor = Cursor::new(bytes);
    let reader = serialize_packed::read_message(&mut cursor, ReaderOptions::new())?;
    Ok(reader)
}
