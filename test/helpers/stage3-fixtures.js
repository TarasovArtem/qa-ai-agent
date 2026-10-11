"use strict";

/**
 * Test-only fixtures for the Controlled-v1 Stage 3 commands (design, plan,
 * generate, review show): a synthetic Cypress target repository, the
 * scripted provider responses of one valid design -> plan -> generate chain,
 * and a content-hash snapshot of the target tree used to prove that the
 * success paths never modify target source.
 *
 * Provider responses are deterministic because #22B evidence ingestion is:
 * requirement i of the requirements file always becomes canonical evidence
 * `evidence-000i` / `user-input-000i`.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const { scratch, hermeticEnv } = require("./qa-agent-cli");

const PROJECT_ID = "stage3-web";
const FRAMEWORK = "cypress";
const GENERATED_SPEC = "cypress/e2e/generated/login.cy.js";
const EXISTING_SPEC = "cypress/e2e/existing.cy.js";
const SECRET = "SENTINEL_STAGE3_AI_KEY_9f1c";

const REQUIREMENTS = {
  schemaVersion: 1,
  requirements: [
    {
      id: "REQ-1",
      type: "requirement",
      title: "Login error",
      content: "When invalid credentials are submitted, the login page shows an error.",
      acceptanceCriteria: [{ id: "AC-1", text: "Given invalid credentials, an error message is displayed." }],
    },
    { id: "REQ-2", type: "requirement", title: "Logout", content: "When the user logs out, the login page is shown." },
  ],
};

function stage3Config(overrides = {}) {
  return {
    schemaVersion: 1,
    projectProfile: { id: PROJECT_ID, displayName: "Stage 3 test web", knownProjectConstraints: ["Synthetic Stage 3 target."] },
    framework: FRAMEWORK,
    requirements: { source: "file", path: "qa/requirements.json" },
    capabilities: { design: true, plan: true, generate: true },
    providers: { allow: ["mock", "groq"] },
    ...overrides,
  };
}

function write(root, rel, text) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
}

function makeStage3Root(config = stage3Config()) {
  const root = scratch("qa-agent-stage3-");
  write(root, "qa-agent.config.json", JSON.stringify(config, null, 2));
  write(root, "qa/requirements.json", JSON.stringify(REQUIREMENTS, null, 2));
  write(root, "cypress.config.js", "module.exports = { e2e: { specPattern: 'cypress/e2e/**/*.cy.js' } };\n");
  write(root, "package.json", JSON.stringify({ name: "stage3-target", private: true, scripts: { "test:e2e": "cypress run", deploy: "echo deploy" } }, null, 2));
  write(root, EXISTING_SPEC, "describe('existing', () => { it('works', () => {}); });\n");
  return root;
}

function generativeEnv(overrides = {}) {
  return hermeticEnv({ AI_PROVIDER: "groq", AI_MODEL: "stage3-model", AI_API_KEY: SECRET, ...overrides });
}

const EVIDENCE = [
  { id: "evidence-0001", kind: "user_input", sourceId: "user-input-0001" },
  { id: "evidence-0002", kind: "user_input", sourceId: "user-input-0002" },
];

function requirementModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "RequirementModel",
    id: "rm-1",
    projectId: PROJECT_ID,
    evidenceRefs: EVIDENCE,
    requirements: [
      { id: "req-1", text: "Invalid credentials show an error on the login page.", evidenceRefIds: ["evidence-0001"] },
      { id: "req-2", text: "Logging out shows the login page.", evidenceRefIds: ["evidence-0002"] },
    ],
    assumptions: [],
    openQuestions: [],
    ...overrides,
  };
}

function testCaseModel(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "TestCaseModel",
    id: "tcm-1",
    projectId: PROJECT_ID,
    requirementModelId: "rm-1",
    testCases: [
      {
        id: "tc-1",
        title: "Invalid login shows error",
        objective: "Verify the error for invalid credentials.",
        requirementIds: ["req-1"],
        steps: [{ action: "Submit invalid credentials.", expectedResult: "An error message is displayed.", requirementIds: ["req-1"] }],
      },
      {
        id: "tc-2",
        title: "Logout returns to login",
        objective: "Verify logout.",
        requirementIds: ["req-2"],
        steps: [{ action: "Log out.", expectedResult: "The login page is displayed.", requirementIds: ["req-2"] }],
      },
    ],
    ...overrides,
  };
}

function candidate(testCaseId, decision, id) {
  return {
    schemaVersion: 1,
    kind: "AutomationCandidate",
    id,
    projectId: PROJECT_ID,
    testCaseModelId: "tcm-1",
    testCaseId,
    decision,
    rationale: "The expected result is deterministic and grounded in user-input evidence.",
    evidenceRefs: [EVIDENCE[0]],
    rationaleEvidenceRefIds: ["evidence-0001"],
    targetFrameworks: [FRAMEWORK],
  };
}

function automationPlan(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "AutomationPlan",
    id: "plan-1",
    projectId: PROJECT_ID,
    automationCandidateId: "ac-1",
    framework: FRAMEWORK,
    plannedChanges: [{ path: GENERATED_SPEC, operation: "CREATE", purpose: "Cover the invalid-login error." }],
    ...overrides,
  };
}

const GENERATED_CONTENT = "describe('login', () => {\n  it('shows an error for invalid credentials', () => {\n    cy.visit('/login');\n  });\n});\n";

function changeSetResponse(overrides = {}) {
  return [{ operation: "CREATE", path: GENERATED_SPEC, content: GENERATED_CONTENT, ...overrides }];
}

const json = (value) => ({ response: JSON.stringify(value) });

const RESPONSES = Object.freeze({
  design: () => [json(requirementModel()), json(testCaseModel()), json(candidate("tc-1", "AUTOMATE", "ac-1")), json(candidate("tc-2", "DO_NOT_AUTOMATE", "ac-2"))],
  plan: () => [json(automationPlan())],
  generate: () => [json(changeSetResponse())],
});

function writeScript(dir, responses, extra = {}) {
  const file = path.join(dir, `provider-script-${crypto.randomBytes(4).toString("hex")}.json`);
  fs.writeFileSync(file, JSON.stringify({ responses, ...extra }));
  return file;
}

// sha256 of every file under root, except the given repository-relative
// prefixes (the product output directory).
function snapshotTree(root, { exclude = ["reports"] } = {}) {
  const out = {};
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (exclude.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
      if (entry.isDirectory()) walk(full);
      else out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
    }
  })(root);
  return out;
}

module.exports = {
  PROJECT_ID,
  FRAMEWORK,
  GENERATED_SPEC,
  GENERATED_CONTENT,
  EXISTING_SPEC,
  SECRET,
  REQUIREMENTS,
  stage3Config,
  makeStage3Root,
  generativeEnv,
  requirementModel,
  testCaseModel,
  candidate,
  automationPlan,
  changeSetResponse,
  json,
  RESPONSES,
  writeScript,
  snapshotTree,
};
