use qa_agent_controller_v1::wire::{
    decode_broker_frame, decode_client_frame, encode_broker_frame, encode_client_frame, BrokerFrameKind, Decoded,
    MAX_RAW_PAYLOAD, MAX_STRUCTURAL_PAYLOAD,
};

#[test]
fn client_frame_round_trip_and_partial_input() {
    let f = encode_client_frame(b"{}").unwrap();
    assert_eq!(f, [0, 0, 0, 2, b'{', b'}']);
    assert_eq!(decode_client_frame(&f[..2]).unwrap(), Decoded::Incomplete { needed: 4 });
    assert_eq!(decode_client_frame(&f[..5]).unwrap(), Decoded::Incomplete { needed: 6 });
    let mut two = f.clone();
    two.extend_from_slice(&f);
    assert_eq!(decode_client_frame(&two).unwrap(), Decoded::Complete { kind: (), payload: &b"{}"[..], consumed: 6 });
}

#[test]
fn client_frame_length_is_checked_before_payload() {
    let at = vec![b' '; MAX_STRUCTURAL_PAYLOAD];
    assert!(encode_client_frame(&at).is_ok());
    assert_eq!(encode_client_frame(&[b' '; MAX_STRUCTURAL_PAYLOAD + 1]).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
    // A header announcing an oversize frame is refused with no payload present.
    let header = ((MAX_STRUCTURAL_PAYLOAD + 1) as u32).to_be_bytes();
    assert_eq!(decode_client_frame(&header).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
    assert_eq!(decode_client_frame(&u32::MAX.to_be_bytes()).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
}

#[test]
fn broker_frame_kinds_and_limits() {
    let s = encode_broker_frame(BrokerFrameKind::Structural, b"{}").unwrap();
    assert_eq!(s, [3, 0, 0, 0, 2, b'{', b'}']);
    match decode_broker_frame(&s).unwrap() {
        Decoded::Complete { kind, payload, consumed } => {
            assert_eq!((kind, payload, consumed), (BrokerFrameKind::Structural, &b"{}"[..], 7));
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(encode_broker_frame(BrokerFrameKind::Stdout, &[0u8; MAX_RAW_PAYLOAD]).unwrap()[0], 1);
    assert_eq!(encode_broker_frame(BrokerFrameKind::Stderr, &[0u8; 1]).unwrap()[0], 2);
    assert_eq!(
        encode_broker_frame(BrokerFrameKind::Stdout, &[0u8; MAX_RAW_PAYLOAD + 1]).unwrap_err().code,
        "WIRE_FRAME_TOO_LARGE"
    );
    assert!(encode_broker_frame(BrokerFrameKind::Structural, &[b' '; MAX_RAW_PAYLOAD + 1]).is_ok());
    let mut raw_header = vec![2u8];
    raw_header.extend_from_slice(&((MAX_RAW_PAYLOAD + 1) as u32).to_be_bytes());
    assert_eq!(decode_broker_frame(&raw_header).unwrap_err().code, "WIRE_FRAME_TOO_LARGE");
    for bad_kind in [0u8, 4, 255] {
        assert_eq!(decode_broker_frame(&[bad_kind, 0, 0, 0, 0]).unwrap_err().code, "WIRE_UNKNOWN_KIND");
    }
    assert_eq!(decode_broker_frame(&[]).unwrap(), Decoded::Incomplete { needed: 1 });
    assert_eq!(decode_broker_frame(&[3, 0]).unwrap(), Decoded::Incomplete { needed: 5 });
}
