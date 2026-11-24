# Controlled v1 Release Contract v1.0 — Recovered Working Normative Baseline

Status: **WORKING NORMATIVE BASELINE — RECOVERED EXTRACTS, PRODUCT OWNER CONFIRMED (2026-11-24); NOT A BYTE-IDENTICAL COPY OF THE 2026-10-01 ORIGINAL**

Lifecycle: canonicalized under `OD-GOV-R1-CANON`. Independent `LIGHT` documentation review is pending. This document is not a release grant, not release qualification and not risk acceptance.

Product Owner authority:

```text
OD-R1-ACCELERATION-1   — APPROVED 2026-11-24
OD-R1-RC-RECOVERY-1    — APPROVED 2026-11-24
OD-GOV-R1-CANON        — APPROVED 2026-11-24
```

Repository baseline at canonicalization:

```text
repository: TarasovArtem/qa-ai-agent
main:       96ebc4f6e741885dc3491b176fb23e7f82b9f32e
tree:       f2396954d87e0ce7739c6abfc64aff4787a4b5d9
```

## 1. Purpose

This document is the canonical record of the Release Contract v1.0 acceptance criteria `RC-01`..`RC-12` and of the general release acceptance conditions of the QA AI Agent v1.0 Controlled Agent Release (R1).

It closes the provenance gap recorded in [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) §4, which says the normative acceptance text was not a tracked repository artifact. It does not create a new contract, and it does not widen or narrow the approved release scope.

## 2. Provenance

| Item | Record |
|---|---|
| Original | Release Contract v1.0. According to the PO-confirmed recovery document, the message was dated 2026-10-01 15:19:14 UTC and the PO approval was recorded at 2026-10-01 15:30:45 UTC, both in the Product Owner's project-management correspondence ("QA AI Agent — Project Management"). The original message is not available as a raw file. It has no direct link and no SHA-256. |
| Repository-side provenance of the 2026-10-01 approval | Issue [#198](https://github.com/TarasovArtem/qa-ai-agent/issues/198), created 2026-10-01 15:56:45Z ("Release Contract v1.0: approved as the working release baseline"). Issue [#199](https://github.com/TarasovArtem/qa-ai-agent/issues/199), created 2026-10-01 15:56:59Z ("Release Contract v1.0 approved by Product Owner"). Both list the twelve RC titles only. |
| Prior search | `RC-BASELINE-RECOVERY-1` (2026-11-24, read-only) found **no** copy of the normative text in this repository, in the Issue texts or their edit history, or in the inspected local and drive storage. The 2026-10-01 `PM-P0-02` analysis had already recorded the text as unavailable. |
| Recovery input | `QA_AI_Agent_Release_Contract_v1.0_Recovery_Review.md` (Product Owner review document, consolidated 2026-11-24), SHA-256 `bbad3615ec0554e29e3a851b774f82100f9b0b27ecc125c51b5388af9cbef6f4`, 10999 bytes. It is built from extracts of the historical correspondence and from search summaries. |
| Confirmation | `OD-R1-RC-RECOVERY-1 — APPROVED` (2026-11-24). The Product Owner confirmed the recovered `RC-01`..`RC-12` criteria and the general release conditions as the **working normative baseline for Controlled Agent R1**. The PO also acknowledged that the text is recovered from extracts and is not a byte-identical copy of the 2026-10-01 original. |
| Fidelity of this record | §3.1 and §4.1 reproduce the confirmed wording of the recovery input verbatim, in its original language (Russian). |

**Provenance limitations (carried, not resolved):**

1. Wording is recovered from extracts, not copied from the original. Exact original formatting is not established.
2. The recovery input states that the wording of all twelve criteria was found. It also states that the **completeness of the other conditions** of the original message, including possible additional caveats to the general conditions, is **not established**.
3. If the original message is later produced, it must be compared with this document. Any difference is a matter for an explicit Product Owner decision. Neither text silently overrides the other.

## 3. Acceptance criteria RC-01..RC-12

### 3.1 Normative wording (governing text, as confirmed)

| ID | Требование | Критерий приёмки |
|---|---|---|
| RC-01 | Установка в сторонний проект | Агент устанавливается без копирования внутреннего исходного кода разработчиком. |
| RC-02 | Получение требований | Поддерживается как минимум один документированный структурированный формат. |
| RC-03 | Анализ требований | Выявляются проблемы тестируемости и формируется отчёт. |
| RC-04 | Создание тест-кейсов | Сценарии связаны с исходными требованиями. |
| RC-05 | План автоматизации | Есть воспроизводимый план для выбранного тестового фреймворка. |
| RC-06 | Генерация E2E-тестов | Создаются исполняемые тесты для пилотной среды. |
| RC-07 | Human approval | Неподтверждённые изменения не применяются и не исполняются. |
| RC-08 | Контролируемое выполнение | Применяются ограничения путей, команд, окружения и времени выполнения. |
| RC-09 | Результаты и отчётность | Пользователь получает результаты запуска, ошибки и необходимые доказательства. |
| RC-10 | Повторяемость | Повторные запуски в одинаковых условиях не нарушают состояние проекта. |
| RC-11 | Безопасность | Выполнены все обязательные для утверждённого объёма security и governance gates. |
| RC-12 | Версионированный выпуск | Потребитель может установить поддерживаемую версию и выполнить документированное обновление. |

### 3.2 English rendering (informative only)

This translation is for navigation. If it differs from §3.1, the wording in §3.1 governs.

| ID | Capability (repository title) | Acceptance criterion (informative translation) |
|---|---|---|
| RC-01 | External installation | The agent is installed without the developer copying internal source code. |
| RC-02 | Requirements ingestion | At least one documented structured format is supported. |
| RC-03 | Requirements analysis | Testability problems are identified and a report is produced. |
| RC-04 | Test-case / test-design generation | Scenarios are linked to the source requirements. |
| RC-05 | Automation planning | A reproducible plan exists for the selected test framework. |
| RC-06 | E2E automation generation | Executable tests are created for the pilot environment. |
| RC-07 | Human approval | Unconfirmed changes are neither applied nor executed. |
| RC-08 | Controlled execution | Restrictions on paths, commands, environment and execution time are enforced. |
| RC-09 | Reporting / evidence | The user receives run results, errors and the necessary evidence. |
| RC-10 | Repeatability | Repeated runs under identical conditions do not corrupt the project state. |
| RC-11 | Security / governance readiness | All security and governance gates mandatory for the approved scope are satisfied. |
| RC-12 | Versioned release / install / upgrade | The consumer can install a supported version and perform the documented upgrade. |

The repository titles match [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) §4 and are unchanged.

## 4. General release acceptance conditions

### 4.1 Normative wording (governing text, as confirmed)

- Три последовательных успешных запуска в изолированной пилотной среде.
- Минимум два отрицательных сценария.
- Обязательные CI, security и governance checks на точном релизном коммите.
- Отсутствие release-blocking defects.
- Установка и повторная установка/обновление по инструкции.
- Документированные результаты, ограничения и восстановление.

### 4.2 English rendering (informative only)

- **GC-1:** three consecutive successful runs in an isolated pilot environment;
- **GC-2:** at least two negative scenarios;
- **GC-3:** mandatory CI, security and governance checks on the exact release commit;
- **GC-4:** no release-blocking defects;
- **GC-5:** installation and re-installation/upgrade following the instructions;
- **GC-6:** documented results, limitations and recovery.

The `GC-1`..`GC-6` labels are reference handles added by this record. They are not part of the confirmed wording.

## 5. Interpretation rules

1. **No added criteria.** This record adds no acceptance criteria and removes none. Where §3.1 or §4.1 is silent, nothing in this document fills the gap. Open questions (§7) need a Product Owner decision. They must not be answered by interpretation.
2. **Cumulative with the release prerequisites.** The mandatory prerequisites 1–11 and the AISEC-6 / SADR-11 dossier in [`controlled-v1-release-model-owner-decision-v1.md`](controlled-v1-release-model-owner-decision-v1.md) §3 and §3.1 still apply alongside this contract. Neither replaces the other. No conflict between them was found at canonicalization.
3. **Implementation is not qualification.** An implementation or exposure status, such as those in [`controlled-v1-productization-contract-v1.md`](controlled-v1-productization-contract-v1.md) §19, shows that a capability exists on `main`. It does not show that an RC criterion or a general condition is met. Qualification needs evidence on the exact release-candidate identity (prerequisite 10, `GC-3`).
4. **Evidence is identity-bound.** Results obtained on another product identity, including Technical Preview (TPR) evidence on candidate `2.0.1` or earlier, are historical. They are not qualification of a later R1 candidate.
5. **Consolidation does not reduce conditions.** Consolidating compatible TPR and R1 qualification (see [ROADMAP §3](../ROADMAP.md#current-po-approved-delivery-priority--controlled-agent-r1-tpr-suspended)) does not waive, merge away or reduce any condition. In particular it does not reduce `GC-1` (three consecutive successful runs) or `GC-2`.
6. **Changes.** Any change to §3.1 or §4.1 needs an explicit Product Owner decision. A change must be marked as a change, never presented as recovered historical text, and versioned (`v2` or later). Earlier versions are kept as evidence.

## 6. Current lifecycle position (non-normative)

As of 2026-11-24:
- R1 is **NOT RELEASE READY / NOT APPROVED**;
- `qa-agent execute` remains **DISABLED**;
- Stage 5 implementation is **NOT AUTHORIZED**;
- no criterion `RC-01`..`RC-12` and no condition `GC-1`..`GC-6` is claimed as qualified for R1.

The RC-by-RC coverage matrix, which separates implementation from qualification, is maintained in Issue [#199](https://github.com/TarasovArtem/qa-ai-agent/issues/199).

## 7. Open questions carried to the Product Owner (not criteria)

| Area | Question |
|---|---|
| RC-08 | The minimum supported execution scope, and how the current requirements are shown to be met before `execute` is enabled. The Stage 5 architecture direction is not approved. |
| RC-06, GC-1 | Which concrete pilot environment counts as the "isolated pilot environment". Release prerequisite 9 names `qa-agent-demo` as the external consumer; its isolation assessment is not decided here. |
| RC-10, GC-1 | Repeatability evidence on the release candidate. The required number of successful runs is preserved. |
| RC-11 | The applicability of open security findings to the enabled scope, decided separately under prerequisite 3. |
| RC-12 | Distribution channel, version, installation, upgrade and recovery/rollback (`OD-01`, `OD-03`, `OD-05`). |
| Provenance | Whether further conditions or caveats existed in the original message (limitation 2 in §2). |

## 8. Non-claims

This document does not:
- implement anything;
- enable `execute` or authorize Stage 5;
- accept or waive any risk or security finding;
- change any security, approval, provider or credential control;
- grant a release, tag or publication;
- close Issue #198 or #199;
- revoke or replace `OD-CONTROLLED-V1-RELEASE-MODEL`.
