//! Sans-IO wire framing (OD-06 §4.2, §7.2, §9.2).
//!
//! - Client frame: u32 big-endian length + exactly that many JSON bytes,
//!   length <= 262144.
//! - Broker frame: kind byte (1 stdout, 2 stderr, 3 structural JSON) + u32
//!   big-endian length + payload; structural <= 262144, raw <= 65536.
//!
//! The length is checked before any payload byte is consumed, so an oversize
//! frame can never be truncated into a shorter, valid-looking one. Reading
//! from pipes, deadlines (intake <= 5000 ms) and queue bounds are runtime
//! concerns of the integration layer and are not implemented here.

use crate::error::{Error, ErrorKind, Result};

/// Maximum client-frame and structural broker-frame payload.
pub const MAX_STRUCTURAL_PAYLOAD: usize = 262_144;
/// Maximum raw stdout/stderr broker-frame payload.
pub const MAX_RAW_PAYLOAD: usize = 65_536;

const fn err(code: &'static str) -> Error {
    Error::new(ErrorKind::Wire, code)
}

/// Outcome of decoding from a possibly partial buffer.
#[derive(Debug, PartialEq, Eq)]
pub enum Decoded<'a, K> {
    /// One full frame; `consumed` bytes of the buffer belong to it.
    Complete {
        /// Frame kind (unit for client frames).
        kind: K,
        /// Payload bytes.
        payload: &'a [u8],
        /// Total bytes consumed including the header.
        consumed: usize,
    },
    /// More input is needed; `needed` is the total buffer length required.
    Incomplete {
        /// Total buffer length required to make progress.
        needed: usize,
    },
}

/// Broker frame kinds (OD-06 §9.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrokerFrameKind {
    /// Raw stdout bytes (kind 1).
    Stdout,
    /// Raw stderr bytes (kind 2).
    Stderr,
    /// Structural JSON frame (kind 3).
    Structural,
}

impl BrokerFrameKind {
    /// Wire byte.
    pub fn byte(self) -> u8 {
        match self {
            BrokerFrameKind::Stdout => 1,
            BrokerFrameKind::Stderr => 2,
            BrokerFrameKind::Structural => 3,
        }
    }

    fn from_byte(b: u8) -> Option<Self> {
        match b {
            1 => Some(BrokerFrameKind::Stdout),
            2 => Some(BrokerFrameKind::Stderr),
            3 => Some(BrokerFrameKind::Structural),
            _ => None,
        }
    }

    fn limit(self) -> usize {
        match self {
            BrokerFrameKind::Structural => MAX_STRUCTURAL_PAYLOAD,
            _ => MAX_RAW_PAYLOAD,
        }
    }
}

fn be_len(b: &[u8]) -> usize {
    u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize
}

/// Encodes one client frame.
pub fn encode_client_frame(payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() > MAX_STRUCTURAL_PAYLOAD {
        return Err(err("WIRE_FRAME_TOO_LARGE"));
    }
    let mut out = Vec::with_capacity(4 + payload.len());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Decodes one client frame from the start of `buf`.
pub fn decode_client_frame(buf: &[u8]) -> Result<Decoded<'_, ()>> {
    if buf.len() < 4 {
        return Ok(Decoded::Incomplete { needed: 4 });
    }
    let len = be_len(&buf[..4]);
    if len > MAX_STRUCTURAL_PAYLOAD {
        return Err(err("WIRE_FRAME_TOO_LARGE"));
    }
    if buf.len() < 4 + len {
        return Ok(Decoded::Incomplete { needed: 4 + len });
    }
    Ok(Decoded::Complete { kind: (), payload: &buf[4..4 + len], consumed: 4 + len })
}

/// Encodes one broker frame.
pub fn encode_broker_frame(kind: BrokerFrameKind, payload: &[u8]) -> Result<Vec<u8>> {
    if payload.len() > kind.limit() {
        return Err(err("WIRE_FRAME_TOO_LARGE"));
    }
    let mut out = Vec::with_capacity(5 + payload.len());
    out.push(kind.byte());
    out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

/// Decodes one broker frame from the start of `buf`.
pub fn decode_broker_frame(buf: &[u8]) -> Result<Decoded<'_, BrokerFrameKind>> {
    let Some(&kind_byte) = buf.first() else {
        return Ok(Decoded::Incomplete { needed: 1 });
    };
    let kind = BrokerFrameKind::from_byte(kind_byte).ok_or(err("WIRE_UNKNOWN_KIND"))?;
    if buf.len() < 5 {
        return Ok(Decoded::Incomplete { needed: 5 });
    }
    let len = be_len(&buf[1..5]);
    if len > kind.limit() {
        return Err(err("WIRE_FRAME_TOO_LARGE"));
    }
    if buf.len() < 5 + len {
        return Ok(Decoded::Incomplete { needed: 5 + len });
    }
    Ok(Decoded::Complete { kind, payload: &buf[5..5 + len], consumed: 5 + len })
}
