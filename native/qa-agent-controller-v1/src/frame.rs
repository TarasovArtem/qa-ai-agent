//! Closed broker structural frames (OD-06 §7.1, §7.2, §11.3).
//!
//! Implemented: the exact frame key set and types, the closed disposition and
//! reason enums, the EXITED observation, the unambiguous per-disposition field
//! rules, and the frame-sequence/transition table.
//!
//! Deliberately NOT decided here (open design questions, see
//! `WP3A-EVIDENCE.md`):
//! - OQ-1: whether `operation`, `unitName`, `attemptDigest` and `observation`
//!   are null or echoed on frames whose §7.2 row does not list them. §7.2 says
//!   unlisted fields are null, yet TERMINAL carries `invocationId` once bound
//!   and §7.1 says `executionId` is echoed in every frame. Only the rules that
//!   are unambiguous are enforced; the rest are neither required nor refused.
//! - RQ-7 (amendment): the identity rule for a RECONCILE final frame at
//!   frameSequence 0 that carries `invocationId`.
//!
//! The AutomationExecutionRecord v2 carried in `record` is checked only for
//! `status` and `reason`; its full closed schema and `recordDigest`
//! verification are deferred.

use crate::closed::{Closed, N_MAX};
use crate::digest::is_h;
use crate::error::{Error, ErrorKind, Result};
use crate::grammar;
use crate::json::{self, Value};
use crate::request::Operation;
use crate::CONTRACT_VERSION;

const K: ErrorKind = ErrorKind::Frame;

const fn err(code: &'static str) -> Error {
    Error::new(K, code)
}

macro_rules! closed_enum {
    ($(#[$m:meta])* $name:ident { $($(#[$vm:meta])* $var:ident = $lit:literal),+ $(,)? }) => {
        $(#[$m])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq)]
        pub enum $name { $($(#[$vm])* $var),+ }
        impl $name {
            /// Wire literal.
            pub fn as_str(self) -> &'static str { match self { $($name::$var => $lit),+ } }
            /// Parses a wire literal; anything else is refused.
            pub fn parse(s: &str) -> Option<Self> { match s { $($lit => Some($name::$var),)+ _ => None } }
        }
    };
}

closed_enum!(
    /// §7.2 broker dispositions.
    Disposition {
        /// REFUSED
        Refused = "REFUSED",
        /// ACCEPTED
        Accepted = "ACCEPTED",
        /// BOUND
        Bound = "BOUND",
        /// STARTED
        Started = "STARTED",
        /// EXITED
        Exited = "EXITED",
        /// TERMINAL
        Terminal = "TERMINAL",
        /// QUARANTINED
        Quarantined = "QUARANTINED",
    }
);

closed_enum!(
    /// §11.3 refusal reasons (REFUSED only).
    RefusalReason {
        /// SCHEMA_INVALID
        SchemaInvalid = "SCHEMA_INVALID",
        /// CALLER_REFUSED
        CallerRefused = "CALLER_REFUSED",
        /// INELIGIBLE
        Ineligible = "INELIGIBLE",
        /// REPLAY
        Replay = "REPLAY",
        /// INPUT_MISMATCH
        InputMismatch = "INPUT_MISMATCH",
        /// INCOMPATIBLE
        Incompatible = "INCOMPATIBLE",
        /// RECOVERY_BUDGET_EXHAUSTED
        RecoveryBudgetExhausted = "RECOVERY_BUDGET_EXHAUSTED",
    }
);

closed_enum!(
    /// §11.3 record reasons (TERMINAL/QUARANTINED).
    RecordReason {
        /// SUCCESS
        Success = "SUCCESS",
        /// ASSERTION_FAILURE
        AssertionFailure = "ASSERTION_FAILURE",
        /// HARD_TIMEOUT
        HardTimeout = "HARD_TIMEOUT",
        /// CANCELLED
        Cancelled = "CANCELLED",
        /// CLIENT_LOST
        ClientLost = "CLIENT_LOST",
        /// PRESUBMIT_FAILURE
        PresubmitFailure = "PRESUBMIT_FAILURE",
        /// START_FAILURE
        StartFailure = "START_FAILURE",
        /// OBSERVATION_EXPIRED
        ObservationExpired = "OBSERVATION_EXPIRED",
        /// RESULT_INVALID
        ResultInvalid = "RESULT_INVALID",
        /// CONTROLLER_FAILURE
        ControllerFailure = "CONTROLLER_FAILURE",
        /// MISSING_UNIT_PROOF
        MissingUnitProof = "MISSING_UNIT_PROOF",
        /// CLEANUP_UNPROVEN
        CleanupUnproven = "CLEANUP_UNPROVEN",
        /// STATE_INCONSISTENT
        StateInconsistent = "STATE_INCONSISTENT",
    }
);

closed_enum!(
    /// §11.3 record status.
    Status {
        /// PASSED
        Passed = "PASSED",
        /// TEST_FAILED
        TestFailed = "TEST_FAILED",
        /// TIMED_OUT
        TimedOut = "TIMED_OUT",
        /// EXECUTION_ERROR
        ExecutionError = "EXECUTION_ERROR",
        /// QUARANTINED
        Quarantined = "QUARANTINED",
    }
);

closed_enum!(
    /// §11.2 `managerResult`.
    ManagerResult {
        /// success
        Success = "success",
        /// exit-code
        ExitCode = "exit-code",
        /// signal
        Signal = "signal",
        /// timeout
        Timeout = "timeout",
        /// other
        Other = "other",
    }
);

/// The frame `reason` field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    /// A refusal reason.
    Refusal(RefusalReason),
    /// A record reason.
    Record(RecordReason),
}

impl Reason {
    /// Wire literal.
    pub fn as_str(self) -> &'static str {
        match self {
            Reason::Refusal(r) => r.as_str(),
            Reason::Record(r) => r.as_str(),
        }
    }

    fn parse(s: &str) -> Option<Self> {
        RefusalReason::parse(s)
            .map(Reason::Refusal)
            .or_else(|| RecordReason::parse(s).map(Reason::Record))
    }
}

/// EXITED observation, exactly {managerResult,exitCode,signal,timeoutObserved,resultExpected}.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Observation {
    /// `managerResult`
    pub manager_result: Option<ManagerResult>,
    /// `exitCode` 0..255
    pub exit_code: Option<u8>,
    /// `signal` 1..64
    pub signal: Option<u8>,
    /// `timeoutObserved`
    pub timeout_observed: bool,
    /// `resultExpected`
    pub result_expected: bool,
}

impl Observation {
    /// Checks the field-visible necessary conditions of `resultExpected=true`:
    /// timeoutObserved=false, signal=null, managerResult success or exit-code
    /// and exitCode 0 or 1. "Launch proven" and "no broker-initiated stop" are
    /// broker facts outside the frame.
    pub fn validate(&self) -> Result<()> {
        if let Some(s) = self.signal {
            if !(1..=64).contains(&s) {
                return Err(err("FRAME_OBSERVATION_SIGNAL"));
            }
        }
        if self.result_expected {
            let manager_ok = matches!(self.manager_result, Some(ManagerResult::Success) | Some(ManagerResult::ExitCode));
            if self.timeout_observed || self.signal.is_some() || !manager_ok || !matches!(self.exit_code, Some(0) | Some(1)) {
                return Err(err("FRAME_OBSERVATION_RESULT_EXPECTED"));
            }
        }
        Ok(())
    }

    fn to_value(self) -> Value {
        Value::object(vec![
            ("managerResult", self.manager_result.map_or(Value::Null, |m| Value::str(m.as_str()))),
            ("exitCode", self.exit_code.map_or(Value::Null, |c| Value::Int(i64::from(c)))),
            ("signal", self.signal.map_or(Value::Null, |s| Value::Int(i64::from(s)))),
            ("timeoutObserved", Value::Bool(self.timeout_observed)),
            ("resultExpected", Value::Bool(self.result_expected)),
        ])
    }

    fn from_value(v: &Value) -> Result<Self> {
        let o = Closed::new(v, &["managerResult", "exitCode", "signal", "timeoutObserved", "resultExpected"], K)?;
        let manager_result = match o.opt_str("managerResult")? {
            None => None,
            Some(s) => Some(ManagerResult::parse(s).ok_or(err("FRAME_MANAGER_RESULT"))?),
        };
        let obs = Observation {
            manager_result,
            exit_code: o.opt_int("exitCode", 0, 255)?.map(|n| n as u8),
            signal: o.opt_int("signal", 1, 64)?.map(|n| n as u8),
            timeout_observed: o.boolean("timeoutObserved")?,
            result_expected: o.boolean("resultExpected")?,
        };
        obs.validate()?;
        Ok(obs)
    }
}

/// One broker structural frame (§7.2).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BrokerFrame {
    /// `operation`
    pub operation: Option<Operation>,
    /// `executionId`
    pub execution_id: Option<String>,
    /// `frameSequence`
    pub frame_sequence: u64,
    /// `disposition`
    pub disposition: Disposition,
    /// `reason`
    pub reason: Option<Reason>,
    /// `attemptDigest`
    pub attempt_digest: Option<String>,
    /// `invocationId`
    pub invocation_id: Option<String>,
    /// `unitName`
    pub unit_name: Option<String>,
    /// `observation` (EXITED)
    pub observation: Option<Observation>,
    /// `record`: AutomationExecutionRecord v2 (only status/reason inspected).
    pub record: Option<Value>,
}

const FRAME_KEYS: [&str; 12] = [
    "schemaVersion", "contractVersion", "operation", "executionId", "frameSequence", "disposition", "reason",
    "attemptDigest", "invocationId", "unitName", "observation", "record",
];

/// Maximum frame JSON size (§7.2).
pub const MAX_FRAME_BYTES: usize = 262_144;

/// Largest `frameSequence`. The field is an OD-06 §11.1 `N` (nonnegative safe
/// integer, `0..=2^53-1`). Serialization and deserialization apply this same
/// bound, so every encodable value parses back to itself and nothing wraps.
pub const MAX_FRAME_SEQUENCE: u64 = N_MAX as u64;

/// Lossless `frameSequence` -> JSON integer conversion; out of range is refused.
fn frame_sequence_value(sequence: u64) -> Result<Value> {
    if sequence > MAX_FRAME_SEQUENCE {
        return Err(err("FRAME_SEQUENCE_RANGE"));
    }
    i64::try_from(sequence).map(Value::Int).map_err(|_| err("FRAME_SEQUENCE_RANGE"))
}

fn opt_str_value(s: &Option<String>) -> Value {
    s.as_ref().map_or(Value::Null, |x| Value::Str(x.clone()))
}

fn record_status_reason(record: &Value) -> Result<(Status, RecordReason)> {
    let status = match record.get("status") {
        Some(Value::Str(s)) => Status::parse(s).ok_or(err("FRAME_RECORD_STATUS"))?,
        _ => return Err(err("FRAME_RECORD_STATUS")),
    };
    let reason = match record.get("reason") {
        Some(Value::Str(s)) => RecordReason::parse(s).ok_or(err("FRAME_RECORD_REASON"))?,
        _ => return Err(err("FRAME_RECORD_REASON")),
    };
    Ok((status, reason))
}

fn require(present: bool, code: &'static str) -> Result<()> {
    if present {
        Ok(())
    } else {
        Err(err(code))
    }
}

impl BrokerFrame {
    /// Closed JSON value of this frame. Refuses a `frameSequence` outside
    /// `0..=MAX_FRAME_SEQUENCE` instead of converting it lossily.
    pub fn to_value(&self) -> Result<Value> {
        Ok(Value::object(vec![
            ("schemaVersion", Value::Int(1)),
            ("contractVersion", Value::str(CONTRACT_VERSION)),
            ("operation", self.operation.map_or(Value::Null, |o| Value::str(o.as_str()))),
            ("executionId", opt_str_value(&self.execution_id)),
            ("frameSequence", frame_sequence_value(self.frame_sequence)?),
            ("disposition", Value::str(self.disposition.as_str())),
            ("reason", self.reason.map_or(Value::Null, |r| Value::str(r.as_str()))),
            ("attemptDigest", opt_str_value(&self.attempt_digest)),
            ("invocationId", opt_str_value(&self.invocation_id)),
            ("unitName", opt_str_value(&self.unit_name)),
            ("observation", self.observation.map_or(Value::Null, Observation::to_value)),
            ("record", self.record.clone().unwrap_or(Value::Null)),
        ]))
    }

    /// Validates field rules, then encodes as CRS-1 canonical JSON bytes
    /// (deterministic ASCII; the structural payload of a kind-3 frame).
    pub fn encode(&self) -> Result<Vec<u8>> {
        self.validate_fields()?;
        let bytes = crate::canonical::encode(&self.to_value()?)?;
        if bytes.len() > MAX_FRAME_BYTES {
            return Err(err("FRAME_TOO_LARGE"));
        }
        Ok(bytes)
    }

    /// Strictly parses and validates one structural frame payload.
    pub fn parse(payload: &[u8]) -> Result<Self> {
        let v = json::parse_strict(payload, json::FRAME_LIMITS)?;
        Self::from_value(&v)
    }

    /// Validates a parsed value as a frame.
    pub fn from_value(v: &Value) -> Result<Self> {
        let o = Closed::new(v, &FRAME_KEYS, K)?;
        o.int("schemaVersion", 1, 1)?;
        o.literal("contractVersion", CONTRACT_VERSION)?;
        let operation = match o.opt_str("operation")? {
            None => None,
            Some(s) => Some(Operation::parse(s).ok_or(err("FRAME_OPERATION"))?),
        };
        let disposition = Disposition::parse(o.str("disposition")?).ok_or(err("FRAME_DISPOSITION"))?;
        let reason = match o.opt_str("reason")? {
            None => None,
            Some(s) => Some(Reason::parse(s).ok_or(err("FRAME_REASON"))?),
        };
        let observation = match o.raw("observation") {
            Value::Null => None,
            other => Some(Observation::from_value(other)?),
        };
        let record = match o.raw("record") {
            Value::Null => None,
            r @ Value::Object(_) => Some(r.clone()),
            _ => return Err(err("FRAME_RECORD_TYPE")),
        };
        let frame = BrokerFrame {
            operation,
            execution_id: o.opt_grammar("executionId", grammar::is_id32)?.map(str::to_owned),
            // Same N bound as serialization; the range check makes the
            // conversion lossless.
            frame_sequence: u64::try_from(o.int("frameSequence", 0, N_MAX)?)
                .map_err(|_| err("FRAME_SEQUENCE_RANGE"))?,
            disposition,
            reason,
            attempt_digest: o.opt_grammar("attemptDigest", is_h)?.map(str::to_owned),
            invocation_id: o.opt_grammar("invocationId", grammar::is_id32)?.map(str::to_owned),
            unit_name: o.opt_str("unitName")?.map(str::to_owned),
            observation,
            record,
        };
        frame.validate_fields()?;
        Ok(frame)
    }

    /// Enforces the unambiguous §7.1/§7.2/§11.3 field rules for the frame's
    /// disposition. Ambiguous cases (OQ-1) are neither required nor refused.
    pub fn validate_fields(&self) -> Result<()> {
        require(self.frame_sequence <= MAX_FRAME_SEQUENCE, "FRAME_SEQUENCE_RANGE")?;
        if let Some(id) = &self.execution_id {
            require(grammar::is_id32(id), "FRAME_EXECUTION_ID")?;
        }
        if let Some(d) = &self.attempt_digest {
            require(is_h(d), "FRAME_ATTEMPT_DIGEST")?;
        }
        if let Some(i) = &self.invocation_id {
            require(grammar::is_id32(i), "FRAME_INVOCATION_ID")?;
        }
        if let Some(u) = &self.unit_name {
            // unitName is derived from executionId, never free input (§7.1).
            let derived = self.execution_id.as_deref().and_then(grammar::unit_name);
            require(derived.as_deref() == Some(u.as_str()), "FRAME_UNIT_NAME")?;
        }
        if let Some(obs) = &self.observation {
            obs.validate()?;
        }
        match self.disposition {
            Disposition::Refused => {
                require(matches!(self.reason, Some(Reason::Refusal(_))), "FRAME_REFUSED_REASON")?;
                // Malformed intake: operation and executionId both null, reason fixed SCHEMA_INVALID.
                match (&self.operation, &self.execution_id) {
                    (Some(_), Some(_)) => {}
                    (None, None) => require(
                        self.reason == Some(Reason::Refusal(RefusalReason::SchemaInvalid)),
                        "FRAME_REFUSED_MALFORMED_REASON",
                    )?,
                    _ => return Err(err("FRAME_REFUSED_IDENTITY")),
                }
                // Proven pre-reservation: no attempt, record, unit or observation.
                require(
                    self.attempt_digest.is_none()
                        && self.record.is_none()
                        && self.invocation_id.is_none()
                        && self.unit_name.is_none()
                        && self.observation.is_none(),
                    "FRAME_REFUSED_NON_NULL",
                )?;
            }
            Disposition::Accepted | Disposition::Bound | Disposition::Started | Disposition::Exited => {
                require(self.execution_id.is_some(), "FRAME_EXECUTION_ID_REQUIRED")?;
                require(self.attempt_digest.is_some(), "FRAME_ATTEMPT_DIGEST_REQUIRED")?;
                require(self.unit_name.is_some(), "FRAME_UNIT_NAME_REQUIRED")?;
                // Progress frames carry null record and reason (§11.3).
                require(self.reason.is_none() && self.record.is_none(), "FRAME_PROGRESS_NON_NULL")?;
                if self.disposition == Disposition::Accepted {
                    // invocationId is first present in BOUND (§7.1).
                    require(self.invocation_id.is_none(), "FRAME_ACCEPTED_INVOCATION_ID")?;
                } else {
                    require(self.invocation_id.is_some(), "FRAME_INVOCATION_ID_REQUIRED")?;
                }
                if self.disposition == Disposition::Exited {
                    require(self.observation.is_some(), "FRAME_OBSERVATION_REQUIRED")?;
                } else {
                    require(self.observation.is_none(), "FRAME_OBSERVATION_NON_NULL")?;
                }
            }
            Disposition::Terminal => {
                require(self.execution_id.is_some(), "FRAME_EXECUTION_ID_REQUIRED")?;
                require(self.attempt_digest.is_some(), "FRAME_ATTEMPT_DIGEST_REQUIRED")?;
                let reason = match self.reason {
                    Some(Reason::Record(r)) => r,
                    _ => return Err(err("FRAME_TERMINAL_REASON")),
                };
                let record = self.record.as_ref().ok_or(err("FRAME_RECORD_REQUIRED"))?;
                let (status, record_reason) = record_status_reason(record)?;
                require(record_reason == reason, "FRAME_RECORD_REASON_MISMATCH")?;
                let consistent = match status {
                    Status::Passed => reason == RecordReason::Success,
                    Status::TestFailed => reason == RecordReason::AssertionFailure,
                    Status::TimedOut => reason == RecordReason::HardTimeout,
                    Status::ExecutionError => matches!(
                        reason,
                        RecordReason::Cancelled
                            | RecordReason::ClientLost
                            | RecordReason::PresubmitFailure
                            | RecordReason::StartFailure
                            | RecordReason::ObservationExpired
                            | RecordReason::ResultInvalid
                    ),
                    Status::Quarantined => false,
                };
                require(consistent, "FRAME_TERMINAL_STATUS_REASON")?;
            }
            Disposition::Quarantined => {
                require(self.execution_id.is_some(), "FRAME_EXECUTION_ID_REQUIRED")?;
                let reason = match self.reason {
                    Some(Reason::Record(r)) => r,
                    _ => return Err(err("FRAME_QUARANTINED_REASON")),
                };
                require(
                    matches!(
                        reason,
                        RecordReason::ControllerFailure
                            | RecordReason::MissingUnitProof
                            | RecordReason::CleanupUnproven
                            | RecordReason::StateInconsistent
                    ),
                    "FRAME_QUARANTINED_REASON",
                )?;
                let record = self.record.as_ref().ok_or(err("FRAME_RECORD_REQUIRED"))?;
                let (status, record_reason) = record_status_reason(record)?;
                require(status == Status::Quarantined && record_reason == reason, "FRAME_QUARANTINED_RECORD")?;
            }
        }
        Ok(())
    }
}

/// Checks one invocation's broker frame stream against the §7.2 transition
/// table and the §7.1 identity-constancy rules.
#[derive(Debug)]
pub struct FrameSequence {
    operation: Operation,
    expected_execution_id: Option<String>,
    next_sequence: u64,
    last: Option<Disposition>,
    unit_name: Option<String>,
    invocation_id: Option<String>,
    ended: bool,
}

impl FrameSequence {
    /// Starts checking the stream answering a request of `operation`.
    /// `execution_id` is the request's executionId, or `None` when the
    /// request was malformed and only a SCHEMA_INVALID REFUSED may follow.
    pub fn new(operation: Operation, execution_id: Option<String>) -> Self {
        FrameSequence {
            operation,
            expected_execution_id: execution_id,
            next_sequence: 0,
            last: None,
            unit_name: None,
            invocation_id: None,
            ended: false,
        }
    }

    /// True once a final frame (REFUSED/TERMINAL/QUARANTINED) was accepted.
    pub fn ended(&self) -> bool {
        self.ended
    }

    fn allowed(&self, next: Disposition) -> bool {
        use Disposition::*;
        match (self.operation, self.last) {
            (Operation::Create, None) => matches!(next, Accepted | Refused),
            (Operation::Reconcile, None) => matches!(next, Refused | Terminal | Quarantined),
            (_, Some(Accepted)) => matches!(next, Bound | Terminal | Quarantined),
            (_, Some(Bound)) => matches!(next, Started | Terminal | Quarantined),
            (_, Some(Started)) => matches!(next, Exited | Terminal | Quarantined),
            (_, Some(Exited)) => matches!(next, Terminal | Quarantined),
            (_, Some(Refused | Terminal | Quarantined)) => false,
        }
    }

    /// Accepts the next structural frame or reports a protocol violation.
    pub fn accept(&mut self, f: &BrokerFrame) -> Result<()> {
        if self.ended {
            return Err(err("SEQUENCE_AFTER_END"));
        }
        if f.frame_sequence != self.next_sequence {
            return Err(err("SEQUENCE_NUMBER"));
        }
        f.validate_fields()?;
        // validate_fields bounds frame_sequence (== next_sequence) by N, so
        // this cannot overflow; checked anyway, fail-closed, before any state
        // is updated.
        let next = self.next_sequence.checked_add(1).ok_or(err("SEQUENCE_NUMBER"))?;
        if !self.allowed(f.disposition) {
            return Err(err("SEQUENCE_TRANSITION"));
        }
        if let Some(op) = f.operation {
            require(op == self.operation, "SEQUENCE_OPERATION")?;
        }
        // A malformed-intake REFUSED (validate_fields: SCHEMA_INVALID, null
        // operation/executionId) may answer any request; every other frame
        // echoes the request executionId (§7.1).
        let malformed_refusal = f.disposition == Disposition::Refused && f.execution_id.is_none();
        if !malformed_refusal {
            require(
                f.execution_id.is_some() && f.execution_id == self.expected_execution_id,
                "SEQUENCE_EXECUTION_ID",
            )?;
        }
        if let Some(u) = &f.unit_name {
            match &self.unit_name {
                Some(known) => require(known == u, "SEQUENCE_UNIT_NAME")?,
                None => self.unit_name = Some(u.clone()),
            }
        }
        match (&self.invocation_id, &f.invocation_id) {
            (Some(known), Some(i)) => require(known == i, "SEQUENCE_INVOCATION_ID")?,
            (None, Some(i)) => {
                // A create stream learns invocationId only from BOUND; a
                // reconcile final frame may carry one (RQ-7, not decided here).
                let learnable = f.disposition == Disposition::Bound || self.operation == Operation::Reconcile;
                require(learnable, "SEQUENCE_INVOCATION_ID_UNBOUND")?;
                self.invocation_id = Some(i.clone());
            }
            (Some(_), None) => {
                // §7.2: TERMINAL invocationId is null iff never bound.
                require(f.disposition != Disposition::Terminal, "SEQUENCE_TERMINAL_INVOCATION_ID")?;
            }
            (None, None) => {}
        }
        self.last = Some(f.disposition);
        self.next_sequence = next;
        if matches!(f.disposition, Disposition::Refused | Disposition::Terminal | Disposition::Quarantined) {
            self.ended = true;
        }
        Ok(())
    }

    /// Raw stdout/stderr frames are allowed only between STARTED and EXITED.
    pub fn accept_raw(&self) -> Result<()> {
        require(!self.ended && self.last == Some(Disposition::Started), "SEQUENCE_RAW_OUTSIDE_WINDOW")
    }
}
