//! B3-02: P0 framing robustness (L1, D-10). Std-only seeded campaign over
//! `wire::decode_client_frame` / `decode_broker_frame` and the root P0 path
//! (client frame -> strict JSON -> closed request), with these oracles:
//! - no panic for any buffer; refusals only with known wire codes;
//! - structural consistency of every result (consumed/needed/limits);
//! - prefix consistency: a prefix never decodes to a different frame, and an
//!   oversize or unknown header is refused as soon as it is complete, so an
//!   oversize frame can never be truncated into a shorter valid one;
//! - chunking invariance of a frame stream under arbitrary split points;
//! - encode/decode round trip at and around the payload limits.

mod common;
mod robustness;

use common::{bytes, valid_create};
use qa_agent_controller_v1::error::ErrorKind;
use qa_agent_controller_v1::request::parse_request;
use qa_agent_controller_v1::wire::{
    decode_broker_frame, decode_client_frame, encode_broker_frame, encode_client_frame, BrokerFrameKind, Decoded,
    MAX_RAW_PAYLOAD, MAX_STRUCTURAL_PAYLOAD,
};
use robustness::*;
use std::panic::{catch_unwind, resume_unwind};

const KINDS: [BrokerFrameKind; 3] = [BrokerFrameKind::Stdout, BrokerFrameKind::Stderr, BrokerFrameKind::Structural];

/// A decode result reduced to comparable data.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Out {
    Complete { kind: u8, payload: Vec<u8>, consumed: usize },
    Incomplete { needed: usize },
    Refused(&'static str),
}

fn client(buf: &[u8], ctx: &str) -> Out {
    match catch_unwind(|| decode_client_frame(buf)) {
        Ok(Ok(Decoded::Complete { payload, consumed, .. })) => Out::Complete { kind: 0, payload: payload.to_vec(), consumed },
        Ok(Ok(Decoded::Incomplete { needed })) => Out::Incomplete { needed },
        Ok(Err(e)) => {
            assert_eq!(e.kind, ErrorKind::Wire, "{ctx}");
            Out::Refused(e.code)
        }
        Err(p) => {
            eprintln!("PANIC {ctx} input={}", hex(buf));
            resume_unwind(p)
        }
    }
}

fn broker(buf: &[u8], ctx: &str) -> Out {
    match catch_unwind(|| decode_broker_frame(buf)) {
        Ok(Ok(Decoded::Complete { kind, payload, consumed })) => {
            Out::Complete { kind: kind.byte(), payload: payload.to_vec(), consumed }
        }
        Ok(Ok(Decoded::Incomplete { needed })) => Out::Incomplete { needed },
        Ok(Err(e)) => {
            assert_eq!(e.kind, ErrorKind::Wire, "{ctx}");
            Out::Refused(e.code)
        }
        Err(p) => {
            eprintln!("PANIC {ctx} input={}", hex(buf));
            resume_unwind(p)
        }
    }
}

fn limit_of(kind: u8) -> usize {
    if kind == 3 {
        MAX_STRUCTURAL_PAYLOAD
    } else {
        MAX_RAW_PAYLOAD
    }
}

/// Structural consistency of one result, plus prefix consistency.
fn check(buf: &[u8], is_client: bool, ctx: &str) -> Out {
    let decode = |b: &[u8]| if is_client { client(b, ctx) } else { broker(b, ctx) };
    let header = if is_client { 4 } else { 5 };
    let out = decode(buf);
    let h = hex(&buf[..buf.len().min(64)]);
    match &out {
        Out::Complete { kind, payload, consumed } => {
            let limit = if is_client { MAX_STRUCTURAL_PAYLOAD } else { limit_of(*kind) };
            assert!(payload.len() <= limit, "{ctx} oversize payload {h}");
            assert_eq!(*consumed, header + payload.len(), "{ctx} consumed {h}");
            assert!(*consumed <= buf.len(), "{ctx} consumed beyond buffer {h}");
            assert_eq!(&buf[header..*consumed], &payload[..], "{ctx} payload slice {h}");
            // Every shorter prefix is incomplete; every longer buffer yields the same frame.
            for cut in [0, 1, header - 1, header, consumed.saturating_sub(1)] {
                if cut < *consumed {
                    match decode(&buf[..cut]) {
                        Out::Incomplete { needed } => assert!(needed > cut && needed <= *consumed, "{ctx} prefix needed {h}"),
                        other => panic!("{ctx} prefix {cut} decoded {other:?} {h}"),
                    }
                }
            }
            let mut longer = buf[..*consumed].to_vec();
            longer.extend_from_slice(b"\x03trailing");
            assert_eq!(decode(&longer), out, "{ctx} extension changed the frame {h}");
        }
        Out::Incomplete { needed } => {
            assert!(*needed > buf.len(), "{ctx} needed not beyond buffer {h}");
            let max_frame = header + MAX_STRUCTURAL_PAYLOAD;
            assert!(*needed <= max_frame, "{ctx} needed beyond any frame {h}");
        }
        Out::Refused(code) => {
            assert!(["WIRE_FRAME_TOO_LARGE", "WIRE_UNKNOWN_KIND"].contains(code), "{ctx} code {code} {h}");
            if is_client {
                assert_eq!(*code, "WIRE_FRAME_TOO_LARGE");
            }
            // Refused as soon as the deciding header bytes are present, and
            // for every longer buffer: never truncated into a valid frame.
            let decided = if *code == "WIRE_UNKNOWN_KIND" { 1 } else { header };
            assert_eq!(decode(&buf[..decided]), out, "{ctx} refusal needs more than the header {h}");
            let mut longer = buf.to_vec();
            longer.resize(buf.len() + 300_000, 0x41);
            assert_eq!(decode(&longer), out, "{ctx} refusal changed with more input {h}");
        }
    }
    out
}

fn header_near_limits(r: &mut Rng, is_client: bool) -> Vec<u8> {
    let mut v = Vec::new();
    let kind = *r.pick(&[1u8, 2, 3, 0, 4, 255]);
    if !is_client {
        v.push(kind);
    }
    let limit = if is_client { MAX_STRUCTURAL_PAYLOAD } else { limit_of(kind) } as u64;
    let len: u64 = match r.below(5) {
        0 => limit,
        1 => limit + 1,
        2 => u32::MAX as u64,
        3 => r.below(64),
        _ => r.below(u32::MAX as u64 + 1),
    };
    v.extend_from_slice(&(len as u32).to_be_bytes());
    let body = (r.below(96) as usize).min(len as usize);
    v.extend((0..body).map(|_| r.below(256) as u8));
    v
}

#[test]
fn arbitrary_buffers_decode_consistently() {
    let mut tally = Tally::default();
    for seed in seeds() {
        let mut r = Rng::new(seed ^ 0x3713E);
        for i in 0..iterations(5_000) {
            let is_client = r.chance(1, 2);
            let mut buf = if r.chance(1, 2) {
                header_near_limits(&mut r, is_client)
            } else {
                (0..r.below(80)).map(|_| r.below(256) as u8).collect()
            };
            if r.chance(1, 3) {
                havoc(&mut r, &mut buf);
            }
            let ctx = format!("wire-arbitrary seed={seed} i={i} client={is_client}");
            match check(&buf, is_client, &ctx) {
                Out::Complete { .. } => tally.add("COMPLETE"),
                Out::Incomplete { .. } => tally.add("INCOMPLETE"),
                Out::Refused(code) => tally.add(code),
            }
        }
    }
    eprintln!("ROBUSTNESS wire-arbitrary {}", tally.line());
    for k in ["COMPLETE", "INCOMPLETE", "WIRE_FRAME_TOO_LARGE", "WIRE_UNKNOWN_KIND"] {
        assert!(tally.get(k) > 0, "{k} never exercised");
    }
}

/// Reassembles frames from `chunks` the way an intake loop would, using only
/// the decoder's documented contract (drain `consumed`, wait for `needed`).
fn reassemble(chunks: &[&[u8]], is_client: bool, ctx: &str) -> Result<Vec<(u8, Vec<u8>)>, &'static str> {
    let mut buf: Vec<u8> = Vec::new();
    let mut frames = Vec::new();
    for chunk in chunks {
        buf.extend_from_slice(chunk);
        loop {
            match check(&buf, is_client, ctx) {
                Out::Complete { kind, payload, consumed } => {
                    frames.push((kind, payload));
                    buf.drain(..consumed);
                }
                Out::Incomplete { .. } => break,
                Out::Refused(code) => return Err(code),
            }
        }
    }
    assert!(buf.len() < if is_client { 4 } else { 5 } + MAX_STRUCTURAL_PAYLOAD, "{ctx} buffer grew unbounded");
    Ok(frames)
}

#[test]
fn frame_streams_are_chunking_invariant() {
    let mut frames_seen = 0u64;
    for seed in seeds() {
        let mut r = Rng::new(seed ^ 0xC4A2);
        for i in 0..iterations(1_000) {
            let is_client = r.chance(1, 2);
            let mut expected: Vec<(u8, Vec<u8>)> = Vec::new();
            let mut stream = Vec::new();
            for _ in 0..=r.below(5) {
                let kind = if is_client { BrokerFrameKind::Structural } else { *r.pick(&KINDS) };
                let limit = if is_client { MAX_STRUCTURAL_PAYLOAD } else { limit_of(kind.byte()) };
                let len = match r.below(20) {
                    0 => limit,
                    1 => 0,
                    _ => r.below(300) as usize,
                };
                let payload: Vec<u8> = (0..len).map(|_| r.below(256) as u8).collect();
                let enc = if is_client { encode_client_frame(&payload) } else { encode_broker_frame(kind, &payload) };
                stream.extend_from_slice(&enc.expect("within limit"));
                expected.push((if is_client { 0 } else { kind.byte() }, payload));
            }
            // Random split points, including 1-byte chunks.
            let mut chunks: Vec<&[u8]> = Vec::new();
            let mut at = 0;
            while at < stream.len() {
                let span = if stream.len() > 4096 { 8192 } else { 64 };
                let step = if r.chance(1, 4) { 1 } else { 1 + r.index(span.min(stream.len() - at)) };
                let step = step.min(stream.len() - at);
                chunks.push(&stream[at..at + step]);
                at += step;
            }
            let ctx = format!("wire-chunking seed={seed} i={i} client={is_client}");
            let got = reassemble(&chunks, is_client, &ctx).unwrap_or_else(|c| panic!("{ctx} refused {c}"));
            assert_eq!(got, expected, "{ctx}");
            assert_eq!(reassemble(&[&stream[..]], is_client, &ctx).unwrap(), expected, "{ctx} one-shot");
            frames_seen += expected.len() as u64;
        }
    }
    eprintln!("ROBUSTNESS wire-chunking frames={frames_seen}");
}

#[test]
fn encode_decode_round_trip_at_limits() {
    for kind in KINDS {
        let limit = limit_of(kind.byte());
        for len in [0, 1, limit - 1, limit] {
            let payload = vec![0x5A; len];
            let enc = encode_broker_frame(kind, &payload).unwrap();
            assert_eq!(broker(&enc, "rt"), Out::Complete { kind: kind.byte(), payload, consumed: 5 + len });
        }
        assert_eq!(encode_broker_frame(kind, &vec![0; limit + 1]).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
        let mut header = vec![kind.byte()];
        header.extend_from_slice(&((limit + 1) as u32).to_be_bytes());
        assert_eq!(broker(&header, "rt-over"), Out::Refused("WIRE_FRAME_TOO_LARGE"));
    }
    for len in [0, MAX_STRUCTURAL_PAYLOAD] {
        let payload = vec![0x5A; len];
        let enc = encode_client_frame(&payload).unwrap();
        assert_eq!(client(&enc, "rt"), Out::Complete { kind: 0, payload, consumed: 4 + len });
    }
    assert_eq!(encode_client_frame(&vec![0; MAX_STRUCTURAL_PAYLOAD + 1]).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
    for len in [MAX_STRUCTURAL_PAYLOAD as u32 + 1, u32::MAX] {
        assert_eq!(client(&len.to_be_bytes(), "rt-over"), Out::Refused("WIRE_FRAME_TOO_LARGE"));
    }
}

#[test]
fn p0_path_frame_json_request_never_panics() {
    // Root P0 intake: one client frame -> strict JSON -> closed CREATE request.
    let valid = encode_client_frame(&bytes(&valid_create())).unwrap();
    let mut tally = Tally::default();
    for seed in seeds() {
        let mut r = Rng::new(seed ^ 0x90);
        for i in 0..iterations(5_000) {
            let mut frame = valid.clone();
            havoc(&mut r, &mut frame);
            // Keep the header consistent half of the time so mutations reach
            // the JSON and schema layers.
            if r.chance(1, 2) && frame.len() >= 4 {
                let n = (frame.len() - 4) as u32;
                frame[..4].copy_from_slice(&n.to_be_bytes());
            }
            let ctx = format!("p0 seed={seed} i={i}");
            match check(&frame, true, &ctx) {
                Out::Complete { payload, .. } => match catch_unwind(|| parse_request(&payload)) {
                    Ok(Ok(_)) => tally.add("REQUEST_OK"),
                    Ok(Err(e)) => {
                        assert!(matches!(e.kind, ErrorKind::Json | ErrorKind::Schema), "{ctx} kind {:?}", e.kind);
                        tally.add(if e.kind == ErrorKind::Json { "JSON_REFUSED" } else { "SCHEMA_REFUSED" });
                    }
                    Err(p) => {
                        eprintln!("PANIC {ctx} payload={}", hex(&payload));
                        resume_unwind(p)
                    }
                },
                Out::Incomplete { .. } => tally.add("INCOMPLETE"),
                Out::Refused(code) => tally.add(code),
            }
        }
    }
    eprintln!("ROBUSTNESS p0-path {}", tally.line());
    for k in ["JSON_REFUSED", "SCHEMA_REFUSED"] {
        assert!(tally.get(k) > 0, "{k} never exercised");
    }
}
