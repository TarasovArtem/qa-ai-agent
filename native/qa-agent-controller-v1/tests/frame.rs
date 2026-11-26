mod common;

use common::*;
use qa_agent_controller_v1::frame::{
    BrokerFrame, Disposition, FrameSequence, ManagerResult, Observation, Reason, RecordReason, RefusalReason,
};
use qa_agent_controller_v1::grammar::unit_name;
use qa_agent_controller_v1::json::Value;
use qa_agent_controller_v1::request::Operation;

fn base(d: Disposition, seq: u64) -> BrokerFrame {
    BrokerFrame {
        operation: None,
        execution_id: Some(EXEC_ID.into()),
        frame_sequence: seq,
        disposition: d,
        reason: None,
        attempt_digest: Some(h('1')),
        invocation_id: None,
        unit_name: unit_name(EXEC_ID),
        observation: None,
        record: None,
    }
}

fn observation(result_expected: bool) -> Observation {
    Observation {
        manager_result: Some(ManagerResult::ExitCode),
        exit_code: Some(1),
        signal: None,
        timeout_observed: false,
        result_expected,
    }
}

fn accepted() -> BrokerFrame {
    base(Disposition::Accepted, 0)
}
fn bound() -> BrokerFrame {
    BrokerFrame { invocation_id: Some(INVOCATION_ID.into()), ..base(Disposition::Bound, 1) }
}
fn started() -> BrokerFrame {
    BrokerFrame { invocation_id: Some(INVOCATION_ID.into()), ..base(Disposition::Started, 2) }
}
fn exited() -> BrokerFrame {
    BrokerFrame {
        invocation_id: Some(INVOCATION_ID.into()),
        observation: Some(observation(true)),
        ..base(Disposition::Exited, 3)
    }
}
fn terminal(seq: u64, status: &str, reason: RecordReason) -> BrokerFrame {
    BrokerFrame {
        invocation_id: Some(INVOCATION_ID.into()),
        reason: Some(Reason::Record(reason)),
        record: Some(record(status, reason.as_str())),
        ..base(Disposition::Terminal, seq)
    }
}
fn refused(reason: RefusalReason) -> BrokerFrame {
    BrokerFrame {
        operation: Some(Operation::Create),
        reason: Some(Reason::Refusal(reason)),
        attempt_digest: None,
        unit_name: None,
        ..base(Disposition::Refused, 0)
    }
}

#[test]
fn every_valid_frame_round_trips_through_canonical_json() {
    let frames = vec![
        refused(RefusalReason::Ineligible),
        accepted(),
        bound(),
        started(),
        exited(),
        terminal(4, "TEST_FAILED", RecordReason::AssertionFailure),
        BrokerFrame {
            reason: Some(Reason::Record(RecordReason::CleanupUnproven)),
            record: Some(record("QUARANTINED", "CLEANUP_UNPROVEN")),
            ..base(Disposition::Quarantined, 1)
        },
    ];
    for f in frames {
        let bytes = f.encode().unwrap();
        let parsed = BrokerFrame::parse(&bytes).unwrap();
        // Canonical bytes are the identity (object member order is not).
        assert_eq!(parsed.encode().unwrap(), bytes);
        assert_eq!((parsed.disposition, parsed.reason, parsed.invocation_id), (f.disposition, f.reason, f.invocation_id));
    }
}

#[test]
fn frame_schema_is_closed() {
    let v = accepted().to_value();
    assert_eq!(BrokerFrame::from_value(&adding(&v, "extra", Value::Null)).unwrap_err().code, "SCHEMA_KEY_SET");
    assert_eq!(BrokerFrame::from_value(&with(&v, &["disposition"], s("DONE"))).unwrap_err().code, "FRAME_DISPOSITION");
    assert_eq!(BrokerFrame::from_value(&with(&v, &["schemaVersion"], Value::Int(2))).unwrap_err().code, "SCHEMA_RANGE");
    assert_eq!(BrokerFrame::from_value(&with(&v, &["reason"], s("NOPE"))).unwrap_err().code, "FRAME_REASON");
    assert_eq!(BrokerFrame::from_value(&with(&v, &["frameSequence"], Value::Int(-1))).unwrap_err().code, "SCHEMA_RANGE");
}

#[test]
fn refused_field_rules() {
    assert!(refused(RefusalReason::Replay).validate_fields().is_ok());
    let with_attempt = BrokerFrame { attempt_digest: Some(h('1')), ..refused(RefusalReason::Replay) };
    assert_eq!(with_attempt.validate_fields().unwrap_err().code, "FRAME_REFUSED_NON_NULL");
    let record_reason = BrokerFrame { reason: Some(Reason::Record(RecordReason::Success)), ..refused(RefusalReason::Replay) };
    assert_eq!(record_reason.validate_fields().unwrap_err().code, "FRAME_REFUSED_REASON");
    let malformed = BrokerFrame { operation: None, execution_id: None, ..refused(RefusalReason::SchemaInvalid) };
    assert!(malformed.validate_fields().is_ok());
    let malformed_wrong_reason = BrokerFrame { operation: None, execution_id: None, ..refused(RefusalReason::Ineligible) };
    assert_eq!(malformed_wrong_reason.validate_fields().unwrap_err().code, "FRAME_REFUSED_MALFORMED_REASON");
    let half = BrokerFrame { execution_id: None, ..refused(RefusalReason::SchemaInvalid) };
    assert_eq!(half.validate_fields().unwrap_err().code, "FRAME_REFUSED_IDENTITY");
}

#[test]
fn progress_frame_field_rules() {
    let a = BrokerFrame { invocation_id: Some(INVOCATION_ID.into()), ..accepted() };
    assert_eq!(a.validate_fields().unwrap_err().code, "FRAME_ACCEPTED_INVOCATION_ID");
    let b = BrokerFrame { invocation_id: None, ..bound() };
    assert_eq!(b.validate_fields().unwrap_err().code, "FRAME_INVOCATION_ID_REQUIRED");
    let e = BrokerFrame { observation: None, ..exited() };
    assert_eq!(e.validate_fields().unwrap_err().code, "FRAME_OBSERVATION_REQUIRED");
    let s2 = BrokerFrame { observation: Some(observation(false)), ..started() };
    assert_eq!(s2.validate_fields().unwrap_err().code, "FRAME_OBSERVATION_NON_NULL");
    let r = BrokerFrame { record: Some(record("PASSED", "SUCCESS")), ..accepted() };
    assert_eq!(r.validate_fields().unwrap_err().code, "FRAME_PROGRESS_NON_NULL");
    let u = BrokerFrame { unit_name: unit_name(OTHER_ID), ..accepted() };
    assert_eq!(u.validate_fields().unwrap_err().code, "FRAME_UNIT_NAME");
    let no_attempt = BrokerFrame { attempt_digest: None, ..accepted() };
    assert_eq!(no_attempt.validate_fields().unwrap_err().code, "FRAME_ATTEMPT_DIGEST_REQUIRED");
}

#[test]
fn observation_result_expected_rule() {
    let ok = observation(true);
    assert!(ok.validate().is_ok());
    for bad in [
        Observation { timeout_observed: true, ..ok },
        Observation { signal: Some(9), exit_code: None, ..ok },
        Observation { manager_result: Some(ManagerResult::Signal), ..ok },
        Observation { manager_result: None, ..ok },
        Observation { exit_code: Some(2), ..ok },
        Observation { exit_code: None, ..ok },
    ] {
        assert_eq!(bad.validate().unwrap_err().code, "FRAME_OBSERVATION_RESULT_EXPECTED", "{bad:?}");
    }
    let not_expected = Observation { manager_result: Some(ManagerResult::Timeout), timeout_observed: true, ..observation(false) };
    assert!(not_expected.validate().is_ok());
    let v = exited().to_value();
    let bad_signal = with(&v, &["observation", "signal"], Value::Int(65));
    assert_eq!(BrokerFrame::from_value(&bad_signal).unwrap_err().code, "SCHEMA_RANGE");
}

#[test]
fn final_frame_status_reason_rules() {
    assert!(terminal(4, "PASSED", RecordReason::Success).validate_fields().is_ok());
    assert!(terminal(4, "TIMED_OUT", RecordReason::HardTimeout).validate_fields().is_ok());
    assert!(terminal(4, "EXECUTION_ERROR", RecordReason::ResultInvalid).validate_fields().is_ok());
    let mismatch = terminal(4, "PASSED", RecordReason::AssertionFailure);
    assert_eq!(mismatch.validate_fields().unwrap_err().code, "FRAME_TERMINAL_STATUS_REASON");
    let quarantine_reason = terminal(4, "EXECUTION_ERROR", RecordReason::ControllerFailure);
    assert_eq!(quarantine_reason.validate_fields().unwrap_err().code, "FRAME_TERMINAL_STATUS_REASON");
    let record_reason_differs = BrokerFrame {
        record: Some(record("PASSED", "SUCCESS")),
        ..terminal(4, "TEST_FAILED", RecordReason::AssertionFailure)
    };
    assert_eq!(record_reason_differs.validate_fields().unwrap_err().code, "FRAME_RECORD_REASON_MISMATCH");
    let q_success = BrokerFrame {
        reason: Some(Reason::Record(RecordReason::Success)),
        record: Some(record("QUARANTINED", "SUCCESS")),
        ..base(Disposition::Quarantined, 1)
    };
    assert_eq!(q_success.validate_fields().unwrap_err().code, "FRAME_QUARANTINED_REASON");
    let no_record = BrokerFrame { record: None, ..terminal(4, "PASSED", RecordReason::Success) };
    assert_eq!(no_record.validate_fields().unwrap_err().code, "FRAME_RECORD_REQUIRED");
}

#[test]
fn create_happy_path_sequence() {
    let mut seq = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    seq.accept(&accepted()).unwrap();
    assert!(seq.accept_raw().is_err());
    seq.accept(&bound()).unwrap();
    seq.accept(&started()).unwrap();
    seq.accept_raw().unwrap();
    seq.accept(&exited()).unwrap();
    assert!(seq.accept_raw().is_err());
    seq.accept(&terminal(4, "PASSED", RecordReason::Success)).unwrap();
    assert!(seq.ended());
    assert_eq!(seq.accept(&terminal(5, "PASSED", RecordReason::Success)).unwrap_err().code, "SEQUENCE_AFTER_END");
}

#[test]
fn sequence_violations() {
    let mut gap = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    gap.accept(&accepted()).unwrap();
    let skipped = BrokerFrame { frame_sequence: 2, ..bound() };
    assert_eq!(gap.accept(&skipped).unwrap_err().code, "SEQUENCE_NUMBER");

    let mut first_bound = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    assert_eq!(first_bound.accept(&BrokerFrame { frame_sequence: 0, ..bound() }).unwrap_err().code, "SEQUENCE_TRANSITION");

    let mut reconcile = FrameSequence::new(Operation::Reconcile, Some(EXEC_ID.into()));
    assert_eq!(reconcile.accept(&accepted()).unwrap_err().code, "SEQUENCE_TRANSITION");

    let mut skip_started = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    skip_started.accept(&accepted()).unwrap();
    skip_started.accept(&bound()).unwrap();
    assert_eq!(skip_started.accept(&BrokerFrame { frame_sequence: 2, ..exited() }).unwrap_err().code, "SEQUENCE_TRANSITION");

    let mut changed = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    changed.accept(&accepted()).unwrap();
    changed.accept(&bound()).unwrap();
    let other_inv = BrokerFrame { invocation_id: Some(OTHER_ID.into()), ..started() };
    assert_eq!(changed.accept(&other_inv).unwrap_err().code, "SEQUENCE_INVOCATION_ID");

    let mut terminal_unbound = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    terminal_unbound.accept(&accepted()).unwrap();
    terminal_unbound.accept(&bound()).unwrap();
    let null_inv = BrokerFrame { invocation_id: None, ..terminal(2, "EXECUTION_ERROR", RecordReason::ClientLost) };
    assert_eq!(terminal_unbound.accept(&null_inv).unwrap_err().code, "SEQUENCE_TERMINAL_INVOCATION_ID");

    let mut invented = FrameSequence::new(Operation::Create, Some(EXEC_ID.into()));
    invented.accept(&accepted()).unwrap();
    let inv_on_terminal = terminal(1, "EXECUTION_ERROR", RecordReason::StartFailure);
    assert_eq!(invented.accept(&inv_on_terminal).unwrap_err().code, "SEQUENCE_INVOCATION_ID_UNBOUND");

    let mut wrong_id = FrameSequence::new(Operation::Create, Some(OTHER_ID.into()));
    assert_eq!(wrong_id.accept(&accepted()).unwrap_err().code, "SEQUENCE_EXECUTION_ID");

    let mut wrong_op = FrameSequence::new(Operation::Reconcile, Some(EXEC_ID.into()));
    assert_eq!(wrong_op.accept(&refused(RefusalReason::Replay)).unwrap_err().code, "SEQUENCE_OPERATION");
}

#[test]
fn reconcile_and_malformed_intake_sequences() {
    let mut r = FrameSequence::new(Operation::Reconcile, Some(EXEC_ID.into()));
    let mut t = terminal(0, "TIMED_OUT", RecordReason::HardTimeout);
    t.invocation_id = Some(INVOCATION_ID.into()); // RQ-7: accepted, not decided
    r.accept(&t).unwrap();
    assert!(r.ended());

    let mut m = FrameSequence::new(Operation::Create, None);
    let malformed = BrokerFrame { operation: None, execution_id: None, ..refused(RefusalReason::SchemaInvalid) };
    m.accept(&malformed).unwrap();
    assert!(m.ended());
}
