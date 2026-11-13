#!/usr/bin/python3
"""Synthetic regression tests for scripts/ci/s01_observer.py.

Python standard library only, deterministic, unprivileged. They launch no
browser, change no cgroup and no mount, and need no network or secrets.
Linux only (the observer itself is Linux only).

    python3 scripts/ci/test_s01_observer.py

They exercise the verdict logic, the process tracker (with a fake /proc),
the static config check and the teardown bookkeeping. They do NOT execute
the privileged qualification and prove nothing about a real runner.
"""
import argparse
import importlib.util
import os
import stat
import sys
import tempfile
import types
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
OBSERVER = os.path.join(HERE, "s01_observer.py")
spec = importlib.util.spec_from_file_location("s01_observer", OBSERVER)
obs = importlib.util.module_from_spec(spec)
spec.loader.exec_module(obs)

# playwright.config.js of the approved qualification target, PR #270 head
# 940b95426197d17dd9ecc14d537f809da98d5edc, verbatim (git blob id below).
PR270_CONFIG_BLOB = "150c21321efcb74814ac0e88cb61eb98ac6fc421"
PR270_CONFIG = r'''const { defineConfig, devices } = require("@playwright/test");

// Roadmap #21F: real production Playwright runtime configuration.
//
// testDir MUST stay exactly "./playwright" (never a deeper path such as
// "./playwright/tests") - this is the explicit, binding contract locked by
// Roadmap #21C-C1 in scripts/ai/collect-context.js's own
// RELEVANT_FILES_POLICIES.playwright comment: under this setting, the real
// reporter emits spec.file relative to playwright/ itself (e.g.
// "tests/smoke.spec.js"), which collect-context.js's
// resolveSpecCandidates() re-roots under playwright/ to find the real
// source file. Changing testDir here without updating that policy would
// silently break Roadmap #21C's RelevantFiles source resolution (R1).
//
// The JSON reporter's outputFile is deliberately identical to
// scripts/ai/adapters/playwright-adapter.js's own DEFAULT_REPORT_FILE
// (reports/playwright/report.json) - the production collect-context CLI
// therefore needs no new Playwright-specific adapterOptions wiring at all;
// QA_FRAMEWORK=playwright already finds this exact file via the adapter's
// existing default.
module.exports = defineConfig({
  testDir: "./playwright",
  outputDir: "reports/playwright/test-results",

  // A single representative smoke flow against a public external SUT -
  // never parallelized, never retried, never run across multiple browsers.
  fullyParallel: false,
  workers: 1,
  retries: 0,

  reporter: [
    ["line"],
    ["json", { outputFile: "reports/playwright/report.json" }],
  ],

  use: {
    baseURL: "https://poi.targomo.com",
    // Repo-local by construction (outputDir above) - never OS temp, never
    // an absolute user-specific directory. Only captured on failure, and
    // this stage does not intentionally produce one (see the smoke spec).
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },

  projects: [
    {
      name: "chromium",
      // CI-PLAYWRIGHT Chrome Channel experiment E1: run on the Google Chrome
      // already installed on the runner (channel "chrome") instead of a
      // runtime-downloaded Playwright Chromium. chromiumSandbox: true only
      // REQUESTS the Chromium sandbox - it is not, by itself, evidence that
      // the renderer sandbox is effective. Never set it to false and never
      // add --no-sandbox here.
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome",
        launchOptions: {
          chromiumSandbox: true,
        },
      },
    },
  ],
});
'''

MINIMAL_OK = (
    'const { defineConfig, devices } = require("@playwright/test");\n'
    'module.exports = defineConfig({\n'
    '  testDir: "./playwright",\n'
    '  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"],\n'
    '    channel: "chrome", launchOptions: { chromiumSandbox: true } } }],\n'
    '});\n')

DEV = os.makedev(8, 1)
INIT = {"user": "user:[1]", "pid": "pid:[1]", "net": "net:[1]"}
SBX = {"user": "user:[9]", "pid": "pid:[9]", "net": "net:[9]"}
RNS = {"user": "user:[9]", "pid": "pid:[10]", "net": "net:[9]"}
CH, HELPER, NODE, DASH, ENV = [DEV, 100], [DEV, 101], [DEV, 5], [DEV, 6], [DEV, 7]
UID = 1002
WORK = "/srv/s01/work"
CTX = {"init_ns": INIT, "chrome_id": CH, "helper_id": HELPER, "node_id": NODE,
       "smoke_root": "root", "work_dir": WORK, "helper_setuid_capable": False,
       "untrusted_uid": UID, "grace": 2.0, "unsampled": [], "table_overflow": False}
CHROME_PATH = "/opt/google/chrome/chrome"
NODE_PATH = "/opt/hostedtoolcache/node/22.0.0/x64/bin/node"
BROWSER_ARGS = ("chrome", "--remote-debugging-pipe")
COMMAND_ARGS = ("node", WORK + "/node_modules/.bin/playwright", "test",
                "--config=playwright.config.js", "--project=chromium")


def state(exe=CH, ns=INIT, args=("chrome",), seccomp=0, nnp=0, eff="000001ffffffffff",
          uid=UID, tracer=0, label="chrome (unconfined)", ppid=1, nspid=(1,),
          exe_path=None, exe_class=None):
    known = {tuple(CH): (CHROME_PATH, "chrome"), tuple(NODE): (NODE_PATH, "node"),
             tuple(DASH): ("/usr/bin/dash", "system"), tuple(ENV): ("/usr/bin/env", "system"),
             tuple(HELPER): ("/opt/google/chrome/chrome-sandbox", "chrome_file")}
    path, klass = known.get(tuple(exe), ("/usr/bin/x", "system"))
    return {"exe": list(exe), "exe_path": exe_path or path, "exe_class": exe_class or klass,
            "ns": dict(ns), "cmdline": list(args), "seccomp": seccomp, "nnp": nnp,
            "cap": {"eff": eff, "prm": eff}, "uid": [uid] * 4, "tracer": tracer,
            "apparmor": label, "ppid": ppid, "nspid": list(nspid)}


def rec(pid, parent, *states, first=0.0, last=10.0, phase="smoke", start=None):
    """A record as the tracker would have built it from these states.

    Each state is seen from its `t` until `t_last` (default: the next
    state's `t`, or `last` for the final state), in active time."""
    sticky = obs.new_sticky()
    for s in states:
        s.setdefault("t", first)
    for index, s in enumerate(states):
        s.setdefault("t_last", states[index + 1]["t"] if index + 1 < len(states) else last)
        obs.fold_state(sticky, s, CH)
        obs.observe_conditions(sticky, s, CH, INIT, s["t_last"] - first)
    return {"pid": pid, "starttime": pid * 10 if start is None else start, "phase": phase,
            "first_seen": first, "last_seen": last, "samples": 5,
            "birth_ppid": states[0]["ppid"], "parent_key": parent,
            "parent_confirmed": parent is not None, "states": list(states),
            "last_state": states[-1], "sticky": sticky, "overflow": False,
            "untrusted_exec_maps": [], "unresolved_exec_maps": [], "maps_ok": 2,
            "maps_failed": 0, "maps_insufficient": 0, "maps_identity_changed": 0,
            "maps_truncated": 0}


def renderer(pid=60, parent="zyg", ppid=40, **kw):
    base = dict(ns=RNS, args=("chrome", "--type=renderer"), seccomp=2, nnp=1,
                eff="0000000000000000", ppid=ppid, nspid=(pid, 7, 1))
    base.update(kw)
    extra = {k: base.pop(k) for k in ("first", "last") if k in base}
    return rec(pid, parent, state(**base), **extra)


def good():
    """Observer-started npm -> sh -> `playwright test` -> worker -> Chrome."""
    return {
        "root": rec(5, None, state(exe=NODE, args=("npm", "run", "test:e2e:playwright"),
                                   label="unconfined", ppid=2)),
        "sh": rec(6, "root", state(exe=DASH, args=("sh", "-c", "playwright test"),
                                   label="unconfined", ppid=5)),
        "cmd": rec(7, "sh", state(exe=ENV, args=("/usr/bin/env", "node"), label="unconfined",
                                  ppid=6),
                   state(exe=NODE, args=COMMAND_ARGS, label="unconfined", ppid=6)),
        "worker": rec(10, "cmd", state(exe=NODE, args=("node", WORK + "/node_modules/playwright/"
                                                       "lib/common/process.js"),
                                       label="unconfined", ppid=7)),
        "browser": rec(20, "worker", state(args=BROWSER_ARGS, ppid=10)),
        "init": rec(30, "browser", state(ns=SBX, args=("chrome", "--type=zygote"), ppid=20,
                                         nspid=(30, 1))),
        "zyg": rec(40, "init", state(ns=SBX, args=("chrome", "--type=zygote"), ppid=30,
                                     nspid=(40, 2))),
        "gpuzyg": rec(50, "browser", state(args=("chrome", "--type=zygote",
                                                 "--no-zygote-sandbox"), ppid=20)),
        "r1": renderer(),
    }


def codes(result, kind):
    return sorted({x["code"] for x in result[kind]})


def run_eval(table, **ctx):
    r = obs.evaluate(table, dict(CTX, **ctx))
    return obs.decide(r["fail"], r["stop"]), r


class FakeProc:
    """A fake /proc + cgroup.procs for the tracker."""

    def __init__(self):
        self.procs = {}
        self.listed = None
        self.on_enumerate = None

    def add(self, pid, ppid, start, exe=NODE, args=("x",), maps=None, **kw):
        self.procs[pid] = dict(ppid=ppid, start=start, state="S", exe=exe, args=args,
                               maps=maps, kw=kw)
        return self

    def reader(self, path, limit=None):
        if path.endswith("cgroup.procs"):
            if self.on_enumerate is not None:
                self.on_enumerate()
            if isinstance(self.listed, Exception):
                raise self.listed
            if isinstance(self.listed, str):
                return self.listed
            pids = self.listed if self.listed is not None else sorted(self.procs)
            return "".join("%d\n" % p for p in pids)
        parts = path.split("/")
        pid = int(parts[2])
        proc = self.procs.get(pid)
        if proc is None:
            raise FileNotFoundError(path)
        if parts[3] == "stat":
            start = proc["start"]
            if callable(start):
                start = start()
            return "%d (x) %s %d " % (pid, proc["state"], proc["ppid"]) + \
                " ".join(["0"] * 17) + " %d 0" % start
        if parts[3] == "maps":
            maps = proc["maps"]
            if isinstance(maps, Exception):
                raise maps
            if maps is None:
                raise FileNotFoundError(path)
            return maps
        raise FileNotFoundError(path)

    def sampler(self, pid):
        proc = self.procs.get(pid)
        if proc is None or proc["state"] in ("Z", "X") or proc.get("unreadable"):
            return None
        start = proc["start"]() if callable(proc["start"]) else proc["start"]
        return start, state(exe=proc["exe"], args=proc["args"], ppid=proc["ppid"], **proc["kw"])

    def tracker(self, **kw):
        kw.setdefault("classify", lambda dev, ino, path, files: (
            "unresolved" if path.endswith(" (deleted)") else
            "untrusted" if path.startswith("/srv/") else
            "anonymous" if ino == 0 else "trusted"))
        kw.setdefault("classify_exe", lambda exe, path, c, f, n: (
            "chrome" if exe == CH else "node" if exe == NODE else "system"))
        kw.setdefault("clock", iter(range(10000)).__next__)
        return obs.Tracker("/cg", CH, UID, node_id=NODE, sampler=self.sampler,
                           reader=self.reader, **kw)


CHROME_MAP = "7f00-7f01 r-xp 00000000 08:01 100 %s\n" % CHROME_PATH
LIBC_MAP = "7f02-7f03 r-xp 00000000 08:01 500 /usr/lib/x86_64-linux-gnu/libc.so.6\n"
VDSO_MAP = "7f04-7f05 r-xp 00000000 00:00 0 [vdso]\n"


def with_tracked(tracker_rec, key="browser"):
    """The reference table with one record's evidence replaced by the tracker's."""
    table = good()
    for field in ("untrusted_exec_maps", "unresolved_exec_maps", "maps_ok", "maps_failed",
                  "maps_insufficient", "maps_identity_changed", "maps_truncated"):
        table[key][field] = tracker_rec[field]
    return table


# ---------------------------------------------------------------------------

class ReferenceControl(unittest.TestCase):
    def test_valid_reference_observation_passes(self):
        v, r = run_eval(good())
        self.assertEqual((v, r["fail"], r["stop"]), ("PASS", [], []))
        s = r["summary"]
        self.assertEqual(s["renderers"]["qualified"], ["r1"])
        self.assertEqual(s["zygotes"], ["init", "zyg"])
        self.assertTrue(s["browser_is_verified_chrome_executable"])
        self.assertEqual(s["setuid_helper"]["determination"], "NOT_USED")
        self.assertFalse(s["apparmor"]["confinement_established"])

    def test_other_valid_shapes_pass(self):
        t = good()
        t["r2"] = renderer(pid=61, ns=dict(RNS, pid="pid:[11]"))
        t["r3"] = renderer(pid=62, ns=dict(RNS, pid="pid:[12]"), first=9.0, last=9.3)
        early = state(ns=RNS, args=("chrome", "--type=zygote"), ppid=40, nspid=(60, 7, 1))
        t["r1"] = rec(60, "zyg", early, renderer()["states"][0])
        t["fork"] = rec(70, "browser", state(args=BROWSER_ARGS, ppid=20),
                        state(exe=[DEV, 77], args=("chrome_crashpad_handler",), ppid=20,
                              exe_path="/opt/google/chrome/chrome_crashpad_handler",
                              exe_class="chrome_file"), last=0.1)
        v, r = run_eval(t)
        self.assertEqual((v, r["stop"]), ("PASS", []))
        self.assertEqual(r["summary"]["renderers"]["qualified"], ["r1", "r2", "r3"])

    def test_confirmed_violations_fail(self):
        t = good()
        t["r1"] = renderer(seccomp=0, nnp=0, eff="0000000000200000")
        v, r = run_eval(t)
        self.assertEqual(v, "FAIL")
        self.assertEqual(codes(r, "fail"), ["RENDERER_HOLDS_CAPABILITIES",
                                            "RENDERER_NO_NEW_PRIVS_UNSET",
                                            "RENDERER_SECCOMP_FILTER_ABSENT"])
        t = good()
        t["r1"] = renderer(ns=dict(RNS, net=INIT["net"]))
        self.assertIn("RENDERER_SHARES_INIT_NET_NAMESPACE", codes(run_eval(t)[1], "fail"))
        t = good()
        t["r2"] = renderer(pid=61, parent="browser", ppid=20, ns=INIT, seccomp=0, nnp=0,
                           nspid=(61,), eff="000001ffffffffff")
        self.assertIn("RENDERER_NOT_NAMESPACED", codes(run_eval(t)[1], "fail"))

    def test_stop_conditions(self):
        t = good()
        t["r1"] = renderer(ns=dict(INIT, pid="pid:[9]", net="net:[9]"))
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertEqual(r["summary"]["setuid_helper"]["determination"], "INDICATED")
        cases = (
            (lambda t: t["browser"]["states"][-1].update(tracer=77), "TRACED_CHROME_PROCESS"),
            (lambda t: t["sh"]["states"][-1].update(uid=[UID, 0, 0, 0]),
             "ROOT_PROCESS_IN_UNTRUSTED_CGROUP"),
            (lambda t: t["browser"].update(phase="npm_ci"), "CHANGED_WORKFLOW_ASSUMPTIONS"),
            (lambda t: t["browser"]["states"][-1]["cmdline"].append("--disable-setuid-sandbox"),
             "CHANGED_BROWSER_ASSUMPTIONS"),
            (lambda t: t.update(h=rec(80, "browser", state(exe=HELPER, args=("chrome-sandbox",),
                                                           ppid=20))),
             "UNSUPPORTED_SANDBOX_INTERPRETATION"),
            (lambda t: t["r1"]["states"][-1].update(apparmor=None), "INCOMPLETE_RENDERER_HISTORY"),
            (lambda t: t.update(r2=renderer(pid=61, ns=dict(RNS, pid="pid:[11]"), seccomp=0,
                                            nnp=0, first=8.0, last=8.2)),
             "INCOMPLETE_RENDERER_HISTORY"),
            (lambda t: t.update(r2=rec(61, "zyg", state(ns=RNS, args=("chrome", "--type=zygote"),
                                                        ppid=40, nspid=(61, 8, 1)),
                                       first=8.0, last=8.1)),
             "AMBIGUOUS_RENDERER_IDENTIFICATION"),
        )
        for mutate, code in cases:
            t = good()
            mutate(t)
            v, r = run_eval(t)
            self.assertEqual(v, "STOP", code)
            self.assertIn(code, codes(r, "stop"))
        self.assertFalse(obs.has_flag(["--no-zygote-sandbox"], "--no-sandbox"))
        self.assertEqual(obs.decide([{"code": "x"}], [{"code": "y"}]), "FAIL")


class P12StaticConfig(unittest.TestCase):
    def test_actual_pr270_configuration_is_accepted(self):
        self.assertEqual(obs.git_blob_id(PR270_CONFIG.encode()), PR270_CONFIG_BLOB)
        self.assertEqual(obs.check_playwright_config(PR270_CONFIG), [])
        self.assertEqual(obs.check_playwright_config(MINIMAL_OK), [])

    def test_settings_only_inside_an_unused_string_are_rejected(self):
        decoy = ('const { defineConfig, devices } = require("@playwright/test");\n'
                 'const unused = "use: { channel: \'chrome\', launchOptions: '
                 '{ chromiumSandbox: true } }";\n'
                 'module.exports = defineConfig({ projects: [{ name: "chromium", '
                 'use: { ...devices["Desktop Chrome"] } }] });\n')
        self.assertTrue(obs.check_playwright_config(decoy))
        inside = MINIMAL_OK.replace('testDir: "./playwright"',
                                    'testDir: "channel: \\"chrome\\", chromiumSandbox: true"')
        self.assertTrue(obs.check_playwright_config(inside))
        only_string = ('const { defineConfig, devices } = require("@playwright/test");\n'
                       'module.exports = defineConfig({ testDir: "x", note: \'channel: "chrome", '
                       'launchOptions: { chromiumSandbox: true }\', projects: [{ name: '
                       '"chromium", use: { ...devices["Desktop Chrome"] } }] });\n')
        self.assertTrue(obs.check_playwright_config(only_string))

    def test_other_static_decoys_are_rejected(self):
        ok = MINIMAL_OK
        variants = {
            "comment only": ok.replace('channel: "chrome", launchOptions: '
                                       '{ chromiumSandbox: true }',
                                       '/* channel: "chrome", launchOptions: '
                                       '{ chromiumSandbox: true } */'),
            "other channel": ok.replace('"chrome"', '"msedge"'),
            "sandbox false": ok.replace("chromiumSandbox: true", "chromiumSandbox: false"),
            "sandbox expression": ok.replace("chromiumSandbox: true",
                                             "chromiumSandbox: process.env.X"),
            "no channel": ok.replace('channel: "chrome", ', ""),
            "extra args": ok.replace("chromiumSandbox: true",
                                     'chromiumSandbox: true, args: ["--no-sandbox"]'),
            "executablePath": ok.replace("{ chromiumSandbox: true }",
                                         '{ chromiumSandbox: true, executablePath: "/tmp/c" }'),
            "settings in the wrong object": ok.replace(
                'projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"],\n'
                '    channel: "chrome", launchOptions: { chromiumSandbox: true } } }]',
                'metadata: { use: { channel: "chrome", launchOptions: { chromiumSandbox: true } } '
                '}, projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]'),
            "second project": ok.replace("}],", '}, { name: "other", use: {} }],'),
            "late spread": ok.replace("launchOptions: { chromiumSandbox: true } }",
                                      "launchOptions: { chromiumSandbox: true }, ...devices.x }"),
            "code after": ok + "module.exports.projects[0].use.channel = undefined;\n",
            "code before": ok.replace("module.exports", "devices.x = 1;\nmodule.exports"),
            "call in body": ok.replace('testDir: "./playwright"', "testDir: evil()"),
            "arrow in body": ok.replace('testDir: "./playwright"', "globalSetup: () => 1"),
            "second literal": ok.replace("});", "}); ({ channel: 1 });"),
            "template literal": ok.replace('"./playwright"', "`./playwright`"),
            "not defineConfig": ok.replace("defineConfig({", "Object.assign({"),
            "other module": ok.replace("@playwright/test", "./evil"),
            "default chromium": ('const { defineConfig, devices } = require("@playwright/test");\n'
                                 'module.exports = defineConfig({ projects: [{ name: "chromium", '
                                 'use: { ...devices["Desktop Chrome"] } }] });\n'),
        }
        for name, text in variants.items():
            self.assertTrue(obs.check_playwright_config(text), name)

    def test_no_substitute_browser_installation_in_observer_or_workflow(self):
        for path in (OBSERVER, os.path.join(HERE, "..", "..", ".github", "workflows",
                                             "s01-sandbox-qualification.yml")):
            with open(path) as fh:
                src = fh.read()
            for needle in ("playwright install", "npx ", "apt-get", "apt install",
                           "--no-sandbox\"]", "chromiumSandbox: false"):
                self.assertNotIn(needle, src, needle)


class P12BrowserBinding(unittest.TestCase):
    def test_valid_playwright_association_is_accepted_and_recorded(self):
        v, r = run_eval(good())
        b = r["summary"]["browser_ancestry"]
        self.assertEqual(v, "PASS")
        self.assertTrue(b["ancestry_verified"])
        self.assertEqual(b["ancestry_to_smoke_root"], ["worker", "cmd", "sh", "root"])
        self.assertEqual((b["launcher"], b["approved_command_process"], b["smoke_root"]),
                         ("worker", "cmd", "root"))
        # Design B: functional binding is named as unprovable, never asserted
        self.assertIn("that Playwright test logic drove this browser",
                      b["not_observed_or_unprovable"])
        self.assertNotIn("established", b)

    def test_browser_launched_by_the_command_process_itself_is_accepted(self):
        t = good()
        del t["worker"]
        t["browser"] = rec(20, "cmd", state(args=BROWSER_ARGS, ppid=7))
        self.assertEqual(run_eval(t)[0], "PASS")

    def assert_unbound(self, table, **ctx):
        v, r = run_eval(table, **ctx)
        self.assertEqual(v, "STOP")
        self.assertIn("BROWSER_ANCESTRY_UNVERIFIED", codes(r, "stop"))
        self.assertFalse(r["summary"]["browser_ancestry"]["ancestry_verified"])
        return r

    def test_arbitrary_non_driver_parent_is_rejected(self):
        # the reviewer's reproduction: confirmed, non-Chrome, but not the driver
        t = good()
        t["x"] = rec(11, "cmd", state(exe=DASH, args=("sh", "-c", "chrome"), label="unconfined",
                                      ppid=7))
        t["browser"] = rec(20, "x", state(args=BROWSER_ARGS, ppid=11))
        self.assert_unbound(t)
        # a parent that is not part of the observer-started process tree at all
        t = good()
        t["alien"] = rec(12, None, state(exe=NODE, args=("node", "x.js"), label="unconfined"))
        t["browser"] = rec(20, "alien", state(args=BROWSER_ARGS, ppid=12))
        self.assert_unbound(t)

    def test_ambiguous_driver_relationship_stops(self):
        t = good()
        t["worker"]["parent_confirmed"] = False            # unconfirmed ancestry link
        self.assert_unbound(t)
        t = good()
        t["sh"]["starttime"] = 99999                       # stale link in the ancestry
        self.assert_unbound(t)
        t = good()
        t["cmd"]["states"][-1]["cmdline"] = ["node", "/tmp/other.js", "test"]
        t["cmd"]["last_state"] = t["cmd"]["states"][-1]    # approved command not an ancestor
        self.assert_unbound(t)
        t = good()
        t["cmd"]["states"][-1]["cmdline"][1] = "/tmp/node_modules/.bin/playwright"
        self.assert_unbound(t)                             # same name, outside the work dir
        self.assert_unbound(good(), smoke_root="sh2")      # different observer-started root
        self.assert_unbound(good(), node_id=None)
        self.assert_unbound(good(), smoke_root=None)
        t = good()
        t["worker"]["overflow"] = True
        self.assertEqual(run_eval(t)[0], "STOP")

    def test_genuine_chrome_decoy_beside_a_real_browser_is_rejected(self):
        # decoy = a second genuine, sandboxed, Playwright-looking Chrome
        t = good()
        t["decoy"] = rec(21, "worker", state(args=BROWSER_ARGS, ppid=10))
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("AMBIGUOUS_BROWSER_IDENTIFICATION", codes(r, "stop"))
        # decoy Chrome + the smoke running in a PR-supplied browser binary
        for path, klass, args in (
                (WORK + "/bin/browser", "unexpected", ("browser",)),
                ("/home/s01u/.cache/ms-playwright/chromium-1/chrome-linux/chrome", "unexpected",
                 ("chrome", "--remote-debugging-pipe")),
                ("/usr/lib/firefox/firefox", "unexpected", ("firefox",)),
                ("/usr/bin/x", "system", ("x", "--type=renderer"))):
            t = good()
            t["other"] = rec(90, "worker", state(exe=[DEV, 999], args=args, ppid=10,
                                                 exe_path=path, exe_class=klass))
            v, r = run_eval(t)
            self.assertEqual(v, "STOP", path)
            self.assertTrue({"UNEXPECTED_EXECUTABLE_IN_SMOKE", "UNEXPECTED_BROWSER_SELECTION"}
                            & set(codes(r, "stop")), path)
        # an executable whose identity class was never established fails closed
        t = good()
        t["sh"]["states"][-1]["exe_class"] = None
        t["sh"]["sticky"] = obs.new_sticky()
        self.assertIn("UNEXPECTED_EXECUTABLE_IN_SMOKE", codes(run_eval(t)[1], "stop"))

    def test_unprovable_part_is_identified_not_asserted(self):
        # A smoke that never uses its (genuine, sandboxed) browser cannot be
        # told apart by kernel facts. Design B: outside the claim, explicitly.
        self.assertIn("does NOT certify that Playwright test logic drove Chrome",
                      obs.SCOPE_STATEMENT)
        claim = obs.SECURITY_CLAIM
        self.assertEqual(sorted(claim), ["boundary", "not_observed_or_unprovable",
                                         "pr_controlled_inputs_not_attested",
                                         "proven_kernel_and_process_facts"])
        self.assertIn("option B", claim["boundary"])
        self.assertTrue(any("test logic drove" in s for s in claim["not_observed_or_unprovable"]))
        self.assertFalse(any("drove" in s or "test logic" in s
                             for s in claim["proven_kernel_and_process_facts"]))
        with open(OBSERVER) as fh:
            src = fh.read()
        for phrase in ("BROWSER_NOT_BOUND_TO_SMOKE", "browser_binding", "Browser-to-smoke"):
            self.assertNotIn(phrase, src, phrase)
        self.assertIn('"functional_browser_to_test_attestation": False', src)

    def test_only_a_foreign_browser_never_passes(self):
        t = {k: v for k, v in good().items() if k in ("root", "sh", "cmd", "worker")}
        t["foreign"] = rec(90, "worker", state(exe=[DEV, 999], args=BROWSER_ARGS, ppid=10,
                                               exe_path="/x/chromium/chrome",
                                               exe_class="unexpected"))
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("NO_BROWSER_OBSERVED", codes(r, "stop"))

    def test_classify_executable(self):
        f = obs.classify_executable

        def st(**kw):
            base = dict(st_dev=DEV, st_ino=6, st_mode=stat.S_IFREG | 0o755, st_uid=0, st_gid=0)
            base.update(kw)
            return lambda path: types.SimpleNamespace(**base)

        self.assertEqual(f(CH, "/anything", CH, frozenset(), NODE), "chrome")
        self.assertEqual(f(NODE, "/anything", CH, frozenset(), NODE), "node")
        self.assertEqual(f([DEV, 77], "/x", CH, frozenset({(DEV, 77)}), NODE), "chrome_file")
        self.assertEqual(f(DASH, "/usr/bin/dash", CH, frozenset(), NODE, st()), "system")
        for path, fn in (("/usr/bin/dash (deleted)", st()), ("/usr/bin/dash", st(st_ino=9)),
                         ("/usr/bin/dash", st(st_uid=UID)), ("/usr/local/bin/tool", st()),
                         ("/usr/bin/dash", st(st_mode=stat.S_IFREG | 0o777)),
                         ("/usr/bin/firefox", st()), (WORK + "/node_modules/.bin/x", st())):
            self.assertEqual(f(DASH, path, CH, frozenset(), NODE, fn), "unexpected", path)


class P13ProcessHistory(unittest.TestCase):
    def test_1_enumerated_pid_with_unavailable_sample(self):
        self.assertEqual(run_eval(good())[0], "PASS")
        fp = FakeProc().add(100, 1, 50)
        fp.listed = [100, 777]                         # 777 enumerated, nothing readable
        tr = fp.tracker()
        tr.tick("smoke")
        self.assertEqual(tr.unsampled_count, 1)
        self.assertEqual(tr.unsampled[0]["kind"], "vanished after enumeration")
        v, r = run_eval(good(), unsampled=tr.unsampled)
        self.assertEqual(v, "STOP")
        self.assertIn("UNSAMPLED_PROCESS", codes(r, "stop"))

    def test_2_unknown_process_identity_after_enumeration(self):
        fp = FakeProc().add(100, 1, 50).add(200, 100, 60)
        fp.procs[200]["state"] = "Z"                   # exited before it was ever sampled
        fp.add(300, 100, 70)
        fp.procs[300]["unreadable"] = True             # alive, but the sample failed
        tr = fp.tracker()
        tr.tick("smoke")
        kinds = sorted(u["kind"] for u in tr.unsampled)
        self.assertEqual(kinds, ["alive but unreadable", "exited before its first sample"])
        self.assertEqual(run_eval(good(), unsampled=tr.unsampled)[0], "STOP")

    def test_verified_exit_of_a_known_process_is_not_uncertainty(self):
        fp = FakeProc().add(100, 1, 50).add(200, 100, 60)
        tr = fp.tracker()
        tr.tick("smoke")
        fp.procs[200]["state"] = "Z"                   # known history, now a zombie
        tr.tick("smoke")
        self.assertEqual((tr.unsampled, tr.unsampled_count), ([], 0))
        self.assertTrue(tr.table["200:60"]["exit_seen"])
        fp.procs[200]["start"] = 61                    # same pid, other identity, zombie
        tr.tick("smoke")
        self.assertEqual(tr.unsampled_count, 1)

    def overflowing_tracker(self):
        """One Chrome `--no-sandbox` state, then more states than the history holds."""
        fp = FakeProc().add(100, 1, 50, exe=CH, args=("chrome", "--no-sandbox"),
                            maps=CHROME_MAP)
        tr = fp.tracker()
        tr.tick("smoke")
        fp.procs[100]["exe"] = [DEV, 555]
        for i in range(obs.MAX_STATES_PER_PROCESS + 5):
            fp.procs[100]["args"] = ("sleep", str(i))
            tr.tick("smoke")
        return tr.table["100:50"]

    def test_3_chrome_identity_survives_history_overflow(self):
        r = self.overflowing_tracker()
        self.assertTrue(r["overflow"])
        self.assertEqual(len(r["states"]), obs.MAX_STATES_PER_PROCESS)
        self.assertEqual(r["states"][0]["exe"], CH)        # first state never overwritten
        self.assertNotEqual(r["last_state"]["exe"], CH)
        self.assertTrue(r["sticky"]["chrome"])
        self.assertTrue(r["sticky"]["left_chrome"])

    def test_4_historical_no_sandbox_flag_is_not_overwritten(self):
        r = self.overflowing_tracker()
        self.assertIn("--no-sandbox", r["sticky"]["flags"])
        t = good()
        r.update(parent_key="worker", parent_confirmed=True, birth_ppid=10)
        t["x"] = r
        v, res = run_eval(t)
        self.assertEqual(v, "FAIL")
        self.assertIn("SANDBOX_DISABLING_FLAG", codes(res, "fail"))
        self.assertIn("INCOMPLETE_EVIDENCE", codes(res, "stop"))
        # the reviewer's reproduction: the stored Chrome state is gone
        r["states"] = [r["last_state"]]
        self.assertEqual(run_eval(t)[0], "FAIL")
        # and the converse: sticky facts lost, states still there
        r2 = self.overflowing_tracker()
        r2.update(parent_key="worker", parent_confirmed=True, birth_ppid=10,
                  sticky=obs.new_sticky(), overflow=False)
        t["x"] = r2
        self.assertEqual(run_eval(t)[0], "FAIL")

    def test_overflow_is_disqualifying_for_any_record(self):
        for key in ("sh", "root", "gpuzyg", "r1"):
            t = good()
            t[key]["overflow"] = True
            v, r = run_eval(t)
            self.assertEqual(v, "STOP", key)
            self.assertIn("INCOMPLETE_EVIDENCE", codes(r, "stop"))
        t = good()
        t["sh"]["sticky"]["overflow"] = True
        self.assertEqual(run_eval(t)[0], "STOP")
        self.assertEqual(run_eval(good(), table_overflow=True)[0], "STOP")

    def test_5_confirmed_fail_followed_by_clean_looking_observations(self):
        fp = FakeProc().add(100, 1, 50, exe=CH, args=("chrome", "--no-sandbox"),
                            maps=CHROME_MAP)
        tr = fp.tracker()
        tr.tick("smoke")
        fp.procs[100]["args"] = BROWSER_ARGS               # later samples look clean
        for _ in range(5):
            tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual(r["last_state"]["cmdline"], list(BROWSER_ARGS))
        r.update(parent_key="worker", parent_confirmed=True, birth_ppid=10, pid=20,
                 starttime=200)
        t = good()
        t["browser"] = r
        v, res = run_eval(t)
        self.assertEqual(v, "FAIL")
        self.assertIn("SANDBOX_DISABLING_FLAG", codes(res, "fail"))
        # sealed, then unsealed, then sealed again: the regression stays
        t = good()
        sealed = renderer()["states"][0]
        t["r1"] = rec(60, "zyg", dict(sealed), dict(sealed, seccomp=0), dict(sealed))
        v, res = run_eval(t)
        self.assertEqual(v, "FAIL")
        self.assertIn("RENDERER_SANDBOX_REGRESSED", codes(res, "fail"))
        # tracing and uid 0 seen once stay seen
        t = good()
        b = t["browser"]["states"][0]
        t["browser"] = rec(20, "worker", dict(b, tracer=9), dict(b))
        self.assertIn("TRACED_CHROME_PROCESS", codes(run_eval(t)[1], "stop"))

    def test_pid_and_start_time_ambiguity_is_conservative(self):
        t = good()
        t["dup"] = rec(60, "zyg", renderer()["states"][0], start=601, first=5.0, last=9.0)
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("PID_IDENTITY_AMBIGUOUS", codes(r, "stop"))
        t = good()                                     # same pid, clearly later: reuse, fine
        t["r1"]["last_seen"] = 4.0
        t["later"] = rec(60, "zyg", renderer()["states"][0], start=700, first=5.0, last=9.0)
        self.assertEqual(run_eval(t)[0], "PASS")

    def test_6_valid_complete_process_history(self):
        fp = FakeProc()
        fp.add(5, 2, 50, args=("npm",))
        fp.add(20, 5, 60, exe=CH, args=BROWSER_ARGS, maps=CHROME_MAP + LIBC_MAP + VDSO_MAP)
        tr = fp.tracker()
        for _ in range(12):
            tr.tick("smoke")
        r = tr.table["20:60"]
        self.assertEqual((tr.unsampled_count, tr.table_overflow, r["overflow"]), (0, False, False))
        self.assertEqual((r["parent_key"], r["parent_confirmed"]), ("5:50", True))
        self.assertEqual(len(r["states"]), 1)
        self.assertGreaterEqual(r["maps_ok"], 2)
        self.assertEqual(r["sticky"]["flags"], ["--remote-debugging-pipe"])
        self.assertEqual(r["states"][0]["exe_class"], "chrome")
        self.assertIn("20:60", tr.export())

    def test_invariant_nothing_added_improves_an_observation_to_pass(self):
        degradations = {
            "unsampled pid": lambda t, c: c.update(unsampled=[{"pid": 9}]),
            "table overflow": lambda t, c: c.update(table_overflow=True),
            "overflow flag": lambda t, c: t["zyg"].update(overflow=True),
            "sticky overflow": lambda t, c: t["worker"]["sticky"].update(overflow=True),
            "no-sandbox in history": lambda t, c: t["browser"]["sticky"]["flags"].append(
                "--no-sandbox"),
            "states erased": lambda t, c: t["r1"].update(states=[], last_state=None,
                                                         sticky=obs.new_sticky()) or t.pop("r1"),
            "tracer": lambda t, c: t["zyg"]["sticky"].update(tracer=True),
            "regressed": lambda t, c: t["r1"]["sticky"].update(regressed=True),
            "uid 0": lambda t, c: t["root"]["sticky"].update(uid0=True),
            "maps failure": lambda t, c: t["r1"].update(maps_failed=1),
            "maps insufficient": lambda t, c: t["browser"].update(maps_insufficient=1),
            "maps identity": lambda t, c: t["zyg"].update(maps_identity_changed=1),
            "no maps": lambda t, c: t["init"].update(maps_ok=0),
            "unresolved map": lambda t, c: t["r1"]["unresolved_exec_maps"].append("x (deleted)"),
            "untrusted map": lambda t, c: t["r1"]["untrusted_exec_maps"].append("/srv/x.so"),
            "parent unconfirmed": lambda t, c: t["zyg"].update(parent_confirmed=False),
            "extra unsealed renderer": lambda t, c: t.update(
                r9=renderer(pid=69, ns=dict(RNS, pid="pid:[19]"), seccomp=0, nnp=0,
                            first=9.0, last=9.1)),
            "extra unknown executable": lambda t, c: t.update(
                u=rec(91, "worker", state(exe=[DEV, 9], ppid=10, exe_path="/tmp/u",
                                          exe_class="unexpected"))),
            "second browser": lambda t, c: t.update(
                b2=rec(21, "worker", state(args=BROWSER_ARGS, ppid=10))),
        }
        for name, mutate in degradations.items():
            table, ctx = good(), dict(CTX)
            mutate(table, ctx)
            result = obs.evaluate(table, ctx)
            self.assertNotEqual(obs.decide(result["fail"], result["stop"]), "PASS", name)
        # ... and a FAIL stays a FAIL whatever else is added or removed
        for name, mutate in degradations.items():
            table, ctx = good(), dict(CTX)
            table["r1"] = renderer(seccomp=0, nnp=0)
            mutate(table, ctx)
            if "r1" not in table:
                continue
            result = obs.evaluate(table, ctx)
            self.assertEqual(obs.decide(result["fail"], result["stop"]), "FAIL", name)


class P15MappingEvidence(unittest.TestCase):
    def browser_tracker(self, maps):
        fp = FakeProc().add(100, 1, 50, exe=CH, args=BROWSER_ARGS, maps=maps)
        return fp, fp.tracker()

    def test_valid_complete_mapping_observation(self):
        fp, tr = self.browser_tracker(CHROME_MAP + LIBC_MAP + VDSO_MAP +
                                      "7f06-7f07 rw-p 00000000 08:01 9 /srv/s01/work/d (deleted)\n")
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_failed"], r["maps_insufficient"],
                          r["maps_identity_changed"]), (1, 0, 0, 0))
        self.assertEqual(run_eval(with_tracked(r))[0], "PASS")

    def test_successful_read_followed_by_terminal_failed_read(self):
        fp, tr = self.browser_tracker(CHROME_MAP)
        tr.tick("smoke")
        fp.procs[100]["maps"] = PermissionError("maps")
        fp.procs[100]["args"] = BROWSER_ARGS + ("--x",)    # state change -> maps re-read
        tr.tick("smoke")
        del fp.procs[100]                                  # never sampled again
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_failed"]), (1, 1))
        v, res = run_eval(with_tracked(r))
        self.assertEqual(v, "STOP")
        self.assertIn("INSUFFICIENT_MAPPING_EVIDENCE", codes(res, "stop"))

    def test_later_success_does_not_hide_an_earlier_failure(self):
        fp, tr = self.browser_tracker(OSError("maps"))
        tr.tick("smoke")
        fp.procs[100]["maps"] = CHROME_MAP
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_failed"]), (1, 1))
        self.assertEqual(run_eval(with_tracked(r))[0], "STOP")

    def test_empty_mapping_response(self):
        fp, tr = self.browser_tracker("")
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_insufficient"]), (0, 1))
        v, res = run_eval(with_tracked(r))
        self.assertEqual(v, "STOP")
        self.assertIn("INSUFFICIENT_MAPPING_EVIDENCE", codes(res, "stop"))

    def test_mapping_response_without_sufficient_executable_provenance(self):
        for maps in (VDSO_MAP,                                   # nothing file-backed
                     LIBC_MAP + VDSO_MAP,                        # own executable absent
                     "7f00-7f01 rw-p 00000000 08:01 100 %s\n" % CHROME_PATH,   # not executable
                     "7f00-7f01 r-xp 00000000 08:01 101 %s\n" % CHROME_PATH,   # other inode
                     "7f00-7f01 r-xp 00000000 08:02 100 %s\n" % CHROME_PATH):  # other device
            fp, tr = self.browser_tracker(maps)
            tr.tick("smoke")
            r = tr.table["100:50"]
            self.assertEqual((r["maps_ok"], r["maps_insufficient"]), (0, 1), maps)
            self.assertEqual(run_eval(with_tracked(r))[0], "STOP")
        # complete once, insufficient later: still not acceptable
        fp, tr = self.browser_tracker(CHROME_MAP)
        tr.tick("smoke")
        fp.procs[100]["maps"] = ""
        fp.procs[100]["args"] = BROWSER_ARGS + ("--x",)
        tr.tick("smoke")
        self.assertEqual(run_eval(with_tracked(tr.table["100:50"]))[0], "STOP")

    def test_pid_identity_changed_between_identity_checks(self):
        fp, tr = self.browser_tracker(CHROME_MAP)
        calls = []

        def start():
            calls.append(1)
            return 50 if len(calls) <= 2 else 51           # sample, pre-check, then changed
        fp.procs[100]["start"] = start
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_identity_changed"]), (0, 1))
        v, res = run_eval(with_tracked(r))
        self.assertEqual(v, "STOP")
        self.assertIn("MAPPING_IDENTITY_UNSTABLE", codes(res, "stop"))

    def test_pid_reused_during_mapping_inspection(self):
        fp, tr = self.browser_tracker(CHROME_MAP)
        tr.tick("smoke")
        self.assertEqual(tr.table["100:50"]["maps_ok"], 1)
        real = fp.reader

        def reused(path, limit=None):
            if path == "/proc/100/maps":
                fp.procs[100]["start"] = 99                # pid now names another process
            return real(path, limit)
        tr.reader = reused
        fp.procs[100]["args"] = BROWSER_ARGS + ("--x",)
        tr.tick("smoke")
        r = tr.table["100:50"]
        self.assertEqual((r["maps_ok"], r["maps_identity_changed"]), (1, 1))
        self.assertEqual(run_eval(with_tracked(r))[0], "STOP")
        fp2, tr2 = self.browser_tracker(CHROME_MAP)        # the process is a zombie by then
        tr2.tick("smoke")
        tr2.reader = lambda path, limit=None: (
            fp2.procs[100].update(state="Z") if path.endswith("/maps") else None
        ) or fp2.reader(path, limit)
        fp2.procs[100]["args"] = BROWSER_ARGS + ("--y",)
        tr2.tick("smoke")
        self.assertEqual(tr2.table["100:50"]["maps_identity_changed"], 1)

    def test_deleted_or_unlinked_executable_mapping(self):
        fp, tr = self.browser_tracker(
            CHROME_MAP + "7f08-7f09 r-xp 00000000 08:01 600 /srv/s01/work/evil.so (deleted)\n")
        tr.tick("smoke")
        v, res = run_eval(with_tracked(tr.table["100:50"]))
        self.assertEqual(v, "STOP")
        self.assertIn("UNRESOLVED_EXECUTABLE_MAPPING", codes(res, "stop"))
        f = obs.classify_exec_mapping
        self.assertEqual(f("08:01", 600, "/x/evil.so (deleted)", frozenset()), "unresolved")
        self.assertEqual(f("00:01", 9, "/memfd:x (deleted)", frozenset()), "unresolved")

    def test_confirmed_untrusted_executable_mapping(self):
        fp, tr = self.browser_tracker(
            CHROME_MAP + "7f08-7f09 r-xp 00000000 08:01 600 /srv/s01/work/evil.so\n")
        tr.tick("smoke")
        v, res = run_eval(with_tracked(tr.table["100:50"]))
        self.assertEqual(v, "FAIL")
        self.assertIn("UNTRUSTED_EXECUTABLE_MAPPING", codes(res, "fail"))

    def test_device_inode_verification_is_preserved(self):
        f = obs.classify_exec_mapping

        def st(**kw):
            base = dict(st_dev=DEV, st_ino=500, st_mode=stat.S_IFREG | 0o755, st_uid=0, st_gid=0)
            base.update(kw)
            return lambda path: types.SimpleNamespace(**base)

        def missing(path):
            raise FileNotFoundError(path)
        self.assertEqual(f("00:00", 0, "[vdso]", frozenset()), "anonymous")
        self.assertEqual(f("08:01", 500, "/usr/lib/libc.so.6", frozenset(), st()), "trusted")
        self.assertEqual(f("08:01", 500, "/gone", frozenset(), missing), "unresolved")
        self.assertEqual(f("08:01", 501, "/usr/lib/libc.so.6", frozenset(), st()), "unresolved")
        self.assertEqual(f("08:02", 500, "/usr/lib/libc.so.6", frozenset(), st()), "unresolved")
        self.assertEqual(f("08:01", 500, "/srv/x.so", frozenset(), st(st_uid=UID)), "untrusted")
        ww = st(st_mode=stat.S_IFREG | 0o777)
        chrome_lib = obs.CHROME_DIR + "/libfoo.so"
        self.assertEqual(f("08:01", 500, chrome_lib, frozenset(), ww), "untrusted")
        self.assertEqual(f("08:01", 500, chrome_lib, frozenset({(DEV, 500)}), ww), "trusted")


class P14LineagePreserved(unittest.TestCase):
    def test_direct_browser_to_renderer_chain(self):
        t = good()
        t["r1"] = renderer(parent="browser", ppid=20)
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("UNSUPPORTED_SANDBOX_INTERPRETATION", codes(r, "stop"))
        self.assertEqual(r["summary"]["renderers"]["qualified"], [])

    def test_fake_or_unsandboxed_zygote(self):
        t = good()
        t["r1"] = renderer(parent="gpuzyg", ppid=50)
        self.assertIn("AMBIGUOUS_RENDERER_IDENTIFICATION", codes(run_eval(t)[1], "stop"))
        t = good()
        t["zyg"] = rec(40, "init", state(ns=SBX, args=("chrome", "--type=utility"), ppid=30,
                                         nspid=(40, 2), seccomp=2, nnp=1))
        self.assertEqual(run_eval(t)[0], "STOP")
        t = good()
        t["zyg"]["states"][-1]["ns"] = dict(SBX, user="user:[77]")
        self.assertIn("UNSUPPORTED_SANDBOX_INTERPRETATION", codes(run_eval(t)[1], "stop"))

    def test_stale_parent_in_evaluate(self):
        t = good()
        t["zyg"]["starttime"] = 999999
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("STALE_PARENT_IDENTITY", codes(r, "stop"))
        t = good()
        t["r1"]["birth_ppid"] = 4242
        self.assertIn("STALE_PARENT_IDENTITY", codes(run_eval(t)[1], "stop"))
        t = good()
        t["r1"]["parent_confirmed"] = False
        self.assertIn("AMBIGUOUS_PROCESS_LINEAGE", codes(run_eval(t)[1], "stop"))

    def test_tracker_never_binds_a_reused_parent_pid(self):
        fp = FakeProc().add(100, 1, 50).add(200, 100, 60)
        tr = fp.tracker()
        tr.tick("smoke")
        self.assertEqual(tr.table["200:60"]["parent_key"], "100:50")
        self.assertFalse(tr.table["100:50"]["parent_confirmed"])     # parent outside cgroup
        fp.add(100, 1, 70).add(300, 100, 55)       # pid 100 reused by a younger process
        tr.tick("smoke")
        self.assertIsNone(tr.table["300:55"]["parent_key"])
        self.assertTrue(tr.table["300:55"]["parent_stale"])
        self.assertEqual(tr.table["200:60"]["parent_key"], "100:50")
        fp.add(400, 300, 80)
        real = fp.reader

        def racing(path, limit=None):              # reparented before confirmation
            if path == "/proc/400/stat":
                fp.procs[400]["ppid"] = 1
            return real(path, limit)
        tr.reader = racing
        tr.tick("smoke")
        self.assertFalse(tr.table["400:80"]["parent_confirmed"])
        self.assertEqual(tr.identify(100), "100:70")
        self.assertIsNone(tr.identify(999))

    def test_freeze_and_thaw_wrap_every_tick(self):
        events = []
        fp = FakeProc().add(100, 1, 50)
        tr = fp.tracker(freeze=lambda: events.append("freeze") or True,
                        thaw=lambda: events.append("thaw") or True)
        tr.tick("smoke")
        tr.freeze = lambda: events.append("freeze-failed") and False
        tr.sampler = lambda pid: (_ for _ in ()).throw(RuntimeError("boom"))
        with self.assertRaises(RuntimeError):
            tr.tick("smoke")
        self.assertEqual(events, ["freeze", "thaw", "freeze-failed", "thaw"])
        self.assertEqual(tr.ticks_unfrozen, 1)


def make_q(tmp):
    return obs.Qualification(argparse.Namespace(
        repository="o/r", run_id="1", run_attempt="1", job="qualify",
        workflow_ref="refs/heads/main", workflow_sha="a" * 40, pr_number="270",
        expected_head_sha="b" * 40, expected_tree_sha="c" * 40, trusted_checkout="/t",
        pr_checkout="/p", node_bin_dir="/n/bin", publish_dir=tmp + "/pub",
        protected_path=[], runner_path="/usr/bin", image_os="", image_version=""))


class Patched(unittest.TestCase):
    NAMES = ("CGROUP_DIR", "CHROME_DIR", "run", "mount_entries", "tool", "read_text",
             "as_untrusted")

    def setUp(self):
        self.tmp = os.path.realpath(tempfile.mkdtemp())
        os.chmod(self.tmp, 0o755)
        self.saved = {k: getattr(obs, k) for k in self.NAMES}
        obs.tool = lambda name: "/bin/true"

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(obs, k, v)


class P2TeardownPreserved(Patched):
    def q(self, umount_rc, mounts_after):
        obs.CGROUP_DIR = self.tmp + "/cg"
        os.mkdir(obs.CGROUP_DIR)
        q = make_q(self.tmp)
        q.cgroup_created = True
        q.mounted = [("/opt", 0), ("/usr/share", 0)]
        # A temp directory is not cgroupfs, so the kill itself is stubbed.
        q.kill_cgroup = lambda wait=15, context="": True
        obs.run = lambda argv, **kw: types.SimpleNamespace(returncode=umount_rc)
        obs.mount_entries = lambda path, text=None: [["ro"]] * mounts_after
        return q

    def test_clean_teardown_adds_no_stop(self):
        q = self.q(0, 0)
        q.teardown()
        self.assertEqual(q.stops, [])
        self.assertTrue(q.ev["teardown"]["complete"])
        self.assertFalse(os.path.exists(obs.CGROUP_DIR))

    def test_unmount_failure_and_remaining_mount(self):
        q = self.q(32, 1)
        q.teardown()
        self.assertEqual({s["code"] for s in q.stops}, {"TEARDOWN_INCOMPLETE"})
        self.assertEqual(q.ev["teardown"]["unmount"]["/opt"]["umount_exit"], 32)
        self.assertEqual(obs.decide(q.fails, q.stops), "STOP")
        self.assertFalse(os.path.exists(obs.CGROUP_DIR))       # later steps still ran
        obs.CGROUP_DIR = self.tmp + "/cg2"
        os.mkdir(obs.CGROUP_DIR)
        q = make_q(self.tmp)
        q.cgroup_created, q.mounted = True, [("/opt", 0)]
        q.kill_cgroup = lambda wait=15, context="": True
        obs.run = lambda argv, **kw: types.SimpleNamespace(returncode=0)
        obs.mount_entries = lambda path, text=None: [["ro"]]   # exit 0 but still mounted
        q.teardown()
        self.assertEqual(obs.decide(q.fails, q.stops), "STOP")

    def test_cgroup_removal_failure_and_remaining_processes(self):
        q = self.q(0, 0)
        open(obs.CGROUP_DIR + "/still-here", "w").close()
        q.teardown()
        self.assertEqual([s["code"] for s in q.stops], ["TEARDOWN_INCOMPLETE"])
        self.assertIn("remove_cgroup", q.stops[0]["detail"])
        obs.CGROUP_DIR = self.tmp + "/cg3"
        os.mkdir(obs.CGROUP_DIR)
        q = make_q(self.tmp)
        q.cgroup_created = True
        q.kill_cgroup = lambda wait=15, context="": False
        q.teardown()
        self.assertIn("tracking cgroup still has processes", q.ev["teardown"]["problems"])
        self.assertEqual(obs.decide(q.fails, q.stops), "STOP")


class P11FilesystemPreserved(Patched):
    def test_exposure_finds_topmost_writable_ancestor(self):
        other = os.getuid() + 1
        top = self.tmp + "/opt"
        target = top + "/google/chrome"
        os.makedirs(target)
        for d in (top, top + "/google", target):
            os.chmod(d, 0o777)
        if obs.exposure(self.tmp, other)[0] == "closed":
            self.assertEqual(obs.exposure(target, other), ("writable", top))
            os.chmod(top, 0o755)
            self.assertEqual(obs.exposure(target, other), ("writable", top + "/google"))
            os.chmod(top + "/google", 0o755)
            os.chmod(target, 0o755)
            self.assertEqual(obs.exposure(target, other), ("closed", None))
            os.chmod(top, 0o700)
            self.assertEqual(obs.exposure(target, other), ("unreachable", None))

    def test_unprotected_ancestor_and_writable_chrome_stop(self):
        q = make_q(self.tmp)
        q.uid = q.gid = 4242
        obs.CHROME_DIR = self.tmp + "/opt/google/chrome"
        os.makedirs(obs.CHROME_DIR)
        os.chmod(self.tmp + "/opt", 0o777)
        with self.assertRaises(obs.Stop) as ctx:
            q.chrome_integrity()
        self.assertEqual(ctx.exception.code, "CHROME_INTEGRITY_BOUNDARY_UNSATISFIED")
        q.ro_roots = [self.tmp + "/opt"]
        kinds = {i["path"]: i["protected_by"] for i in q.chain(obs.CHROME_DIR)}
        self.assertEqual(kinds[obs.CHROME_DIR], "read-only mount")
        obs.run = lambda argv, **kw: types.SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
        q.chain = lambda path: [{"path": "/opt", "protected_by": "read-only mount"}]
        obs.as_untrusted = lambda uid, gid, fn, **kw: {"/opt": False, obs.CHROME_EXE: True}
        with self.assertRaises(obs.Stop) as ctx:
            q.chrome_integrity()
        self.assertIn(obs.CHROME_EXE, ctx.exception.detail)

    def test_mount_read_only_fails_closed(self):
        q = make_q(self.tmp)
        q.must_stay_writable, q.agent_area = ["/home/runner"], ["/home/runner"]
        for tree in ("/", "/usr", "/home", "/home/runner/x"):
            with self.assertRaises(obs.Stop) as ctx:
                q.mount_read_only(tree)
            self.assertEqual(ctx.exception.code, "FILESYSTEM_PROTECTION_UNSATISFIED", tree)
        tree = self.tmp + "/tree"
        os.mkdir(tree)
        obs.read_text = lambda path, limit=None: ""
        obs.run = lambda argv, **kw: types.SimpleNamespace(returncode=0, stderr=b"")
        obs.mount_entries = lambda path, text=None: [] if text is not None else [["rw"]]
        with self.assertRaises(obs.Stop):
            q.mount_read_only(tree)                           # mounted but not read-only
        self.assertEqual((q.ro_roots, q.mounted), ([], [(tree, 0)]))
        obs.mount_entries = lambda path, text=None: [] if text is not None else [["ro"]]
        q.mounted = []
        q.mount_read_only(tree)
        self.assertEqual(q.ro_roots, [tree])

    def test_real_access_probes(self):
        d = self.tmp + "/chrome"
        os.mkdir(d)
        exe = d + "/chrome"
        open(exe, "w").close()
        self.assertTrue(obs.probe_writable(exe) and obs.probe_writable(d))
        os.chmod(exe, 0o555)
        os.chmod(d, 0o555)
        if os.getuid() != 0:
            self.assertFalse(obs.probe_writable(exe) or obs.probe_writable(d))
            self.assertEqual(os.listdir(d), ["chrome"])
        os.chmod(d, 0o755)


SEALED = dict(ns=RNS, args=("chrome", "--type=renderer"), seccomp=2, nnp=1,
              eff="0000000000000000", ppid=40, nspid=(60, 7, 1))


def renderer_history(unsealed, unsealed_until, sealed_at=None, last=10.0):
    """r1 seen unsealed (overrides `unsealed`) from t=0 until `unsealed_until`,
    then sealed from `sealed_at` (default: the same instant) until `last`."""
    early = state(**dict(SEALED, **unsealed))
    early.update(t=0.0, t_last=unsealed_until)
    late = state(**SEALED)
    late["t"] = unsealed_until if sealed_at is None else sealed_at
    return rec(60, "zyg", early, late, last=last)


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def graft(table, tracked, key="r1"):
    """Put a tracker-built record's history into the reference table."""
    for field in ("states", "last_state", "sticky", "first_seen", "last_seen", "overflow",
                  "maps_ok", "maps_failed", "maps_insufficient", "maps_identity_changed",
                  "maps_truncated", "untrusted_exec_maps", "unresolved_exec_maps"):
        table[key][field] = tracked[field]
    return table


class C3RendererHistory(unittest.TestCase):
    """P1-3: violations after the grace period are sticky."""

    def test_renderer_fail_followed_by_sealed_state_stays_fail(self):
        t = good()
        t["r1"] = renderer_history({"seccomp": 0, "nnp": 0}, 5.0)
        self.assertEqual(t["r1"]["last_state"]["seccomp"], 2)          # looks sealed now
        v, r = run_eval(t)
        self.assertEqual(v, "FAIL")
        self.assertEqual(codes(r, "fail"), ["RENDERER_NO_NEW_PRIVS_UNSET",
                                            "RENDERER_SECCOMP_FILTER_ABSENT"])
        self.assertEqual(r["summary"]["renderers"]["qualified"], [])

    def test_each_sticky_condition(self):
        cases = {
            "RENDERER_SECCOMP_FILTER_ABSENT": {"seccomp": 1},
            "RENDERER_NO_NEW_PRIVS_UNSET": {"nnp": 0},
            "RENDERER_HOLDS_CAPABILITIES": {"eff": "0000000000200000"},
            "RENDERER_SHARES_INIT_NET_NAMESPACE": {"ns": dict(RNS, net=INIT["net"])},
            "RENDERER_SHARES_INIT_PID_NAMESPACE": {"ns": dict(RNS, pid=INIT["pid"])},
            "RENDERER_NOT_NAMESPACED": {"ns": dict(INIT)},
            "RENDERER_PID_NAMESPACE_INCONSISTENT": {"nspid": (60,)},
        }
        for code, unsealed in cases.items():
            t = good()
            t["r1"] = renderer_history(unsealed, 3.0)
            v, r = run_eval(t)
            self.assertEqual(v, "FAIL", code)
            self.assertIn(code, codes(r, "fail"))
            # the stored states are erased: the sticky fact alone still decides
            t["r1"]["states"] = [t["r1"]["last_state"]]
            self.assertEqual(run_eval(t)[0], "FAIL", code)

    def test_transition_within_grace_is_not_a_violation(self):
        for unsealed in ({"seccomp": 0, "nnp": 0}, {"eff": "000001ffffffffff"}):
            t = good()
            t["r1"] = renderer_history(unsealed, 1.0)
            self.assertEqual(run_eval(t), run_eval(t))
            self.assertEqual(run_eval(t)[0], "PASS", unsealed)

    def test_namespace_condition_within_grace_is_unsupported(self):
        t = good()
        t["r1"] = renderer_history({"ns": dict(RNS, net=INIT["net"])}, 0.5)
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("UNSUPPORTED_SANDBOX_INTERPRETATION", codes(r, "stop"))

    def test_missing_facts_anywhere_in_history_prevent_pass(self):
        t = good()
        t["r1"] = renderer_history({"nspid": ()}, 0.5)
        v, r = run_eval(t)
        self.assertEqual(v, "STOP")
        self.assertIn("INCOMPLETE_RENDERER_HISTORY", codes(r, "stop"))

    def tracked_renderer(self, frozen_per_tick, active_step, seal_after, ticks, freeze_ok=True):
        clock = Clock()
        fp = FakeProc().add(60, 40, 600, exe=CH, maps=CHROME_MAP,
                            args=("chrome", "--type=renderer"),
                            **{k: v for k, v in SEALED.items() if k not in ("args", "ppid")})
        fp.procs[60]["kw"].update(seccomp=0, nnp=0)

        def pause():                      # the cgroup is frozen while sampling
            clock.now += frozen_per_tick
        fp.on_enumerate = pause
        tr = fp.tracker(clock=clock, init_ns=INIT, freeze=lambda: freeze_ok,
                        thaw=lambda: True)
        for i in range(ticks):
            if i == seal_after:
                fp.procs[60]["kw"].update(seccomp=2, nnp=1)
            tr.tick("smoke")
            clock.now += active_step
        return tr, tr.table["60:600"]

    def test_tracker_records_late_violation_through_later_sealing(self):
        tr, r = self.tracked_renderer(0.0, 1.0, seal_after=4, ticks=7)
        self.assertEqual(r["sticky"]["cond_age"]["RENDERER_SECCOMP_FILTER_ABSENT"], 3.0)
        self.assertEqual(r["last_state"]["seccomp"], 2)
        v, res = run_eval(graft(good(), r))
        self.assertEqual(v, "FAIL")
        self.assertIn("RENDERER_SECCOMP_FILTER_ABSENT", codes(res, "fail"))

    def test_confirmed_freeze_time_is_not_counted_as_renderer_time(self):
        # 10 s of wall time, but only 0.5 s in which the renderer could run
        # before it sealed: not a violation, and the evidence is complete.
        tr, r = self.tracked_renderer(5.0, 0.5, seal_after=2, ticks=6)
        self.assertGreaterEqual(tr.frozen_total, 25.0)
        self.assertEqual(r["sticky"]["cond_age"]["RENDERER_SECCOMP_FILTER_ABSENT"], 0.5)
        self.assertEqual(run_eval(graft(good(), r))[0], "PASS")

    def test_unconfirmed_freeze_time_is_never_deducted(self):
        # Same run, freeze not confirmed: nothing is deducted, so the long
        # unsealed period counts in full (FAIL) and the run is never PASS.
        tr, r = self.tracked_renderer(5.0, 0.5, seal_after=2, ticks=6, freeze_ok=False)
        self.assertEqual(tr.frozen_total, 0.0)
        self.assertEqual(tr.ticks_unfrozen, 6)
        # last unsealed sample at wall 5.5 s, versus 0.5 s active when confirmed
        self.assertEqual(r["sticky"]["cond_age"]["RENDERER_SECCOMP_FILTER_ABSENT"], 5.5)
        v, res = run_eval(graft(good(), r), ticks_unfrozen=tr.ticks_unfrozen)
        self.assertEqual(v, "FAIL")
        self.assertIn("FREEZE_UNCONFIRMED", codes(res, "stop"))


class C3EnumerationAndFreezer(unittest.TestCase):
    def test_failed_pid_enumeration_stops(self):
        for failure in (PermissionError("cgroup.procs"), "12\nnot-a-pid\n"):
            fp = FakeProc().add(100, 1, 50)
            fp.listed = failure
            tr = fp.tracker()
            self.assertIsNone(tr.pids())                  # counted at the source
            tr.tick("smoke")
            self.assertEqual((tr.enumeration_failures, tr.table), (2, {}))
            v, r = run_eval(good(), enumeration_failures=tr.enumeration_failures)
            self.assertEqual(v, "STOP")
            self.assertIn("PROCESS_ENUMERATION_FAILED", codes(r, "stop"))
        self.assertEqual(FakeProc().tracker().pids(), [])          # readable and empty

    def test_unconfirmed_freeze_stops(self):
        for freeze in (lambda: False, None):
            fp = FakeProc().add(100, 1, 50)
            tr = fp.tracker(freeze=freeze, thaw=lambda: True)
            tr.tick("smoke")
            self.assertEqual(tr.ticks_unfrozen, 1)
            v, r = run_eval(good(), ticks_unfrozen=tr.ticks_unfrozen)
            self.assertEqual(v, "STOP")
            self.assertIn("FREEZE_UNCONFIRMED", codes(r, "stop"))

    def test_failed_or_unconfirmed_thaw_stops(self):
        fp = FakeProc().add(100, 1, 50)
        tr = fp.tracker(freeze=lambda: True, thaw=lambda: False)
        with self.assertRaises(obs.Stop) as ctx:
            tr.tick("smoke")
        self.assertEqual(ctx.exception.code, "FREEZER_FAILURE")
        self.assertEqual(tr.thaw_failures, 1)
        v, r = run_eval(good(), thaw_failures=tr.thaw_failures)
        self.assertEqual(v, "STOP")
        self.assertIn("FREEZER_FAILURE", codes(r, "stop"))
        # a thaw failure is reported even when sampling itself raised
        tr.sampler = lambda pid: (_ for _ in ()).throw(RuntimeError("boom"))
        with self.assertRaises(obs.Stop):
            tr.tick("smoke")
        self.assertEqual(tr.thaw_failures, 2)


class C3CgroupFiles(unittest.TestCase):
    def setUp(self):
        self.saved = {k: getattr(obs, k) for k in ("CGROUP_DIR", "FREEZE_WAIT_SECONDS")}
        self.tmp = tempfile.mkdtemp()
        obs.CGROUP_DIR = self.tmp
        obs.FREEZE_WAIT_SECONDS = 0.02

    def tearDown(self):
        for k, v in self.saved.items():
            setattr(obs, k, v)

    def events(self, text):
        with open(self.tmp + "/cgroup.events", "w") as fh:
            fh.write(text)

    def test_freeze_and_thaw_require_confirmation(self):
        self.events("populated 1\nfrozen 1\n")
        self.assertTrue(obs.Qualification.set_frozen(1))
        with open(self.tmp + "/cgroup.freeze") as fh:
            self.assertEqual(fh.read(), "1")
        self.assertFalse(obs.Qualification.set_frozen(0))       # thaw never confirmed
        self.events("populated 1\nfrozen 0\n")
        self.assertTrue(obs.Qualification.set_frozen(0))
        self.assertFalse(obs.Qualification.set_frozen(1))       # freeze never confirmed
        self.events("populated 1\nfrozen 10\n")
        self.assertFalse(obs.Qualification.set_frozen(1))       # exact line only
        os.remove(self.tmp + "/cgroup.events")
        self.assertFalse(obs.Qualification.set_frozen(0))       # I/O failure
        obs.CGROUP_DIR = self.tmp + "/missing"
        self.assertFalse(obs.Qualification.set_frozen(1))

    def test_unreadable_cgroup_is_never_reported_empty(self):
        q = make_q(self.tmp)
        q.tracker = types.SimpleNamespace(pids=lambda context="": None)
        self.assertFalse(q.kill_cgroup(wait=0.05))
        q.tracker = types.SimpleNamespace(pids=lambda context="": [])
        self.assertTrue(q.kill_cgroup(wait=0.05))


class C3MappingTruncation(unittest.TestCase):
    PAD = "7f10-7f11 r--p 00000000 08:01 500 /usr/lib/x86_64-linux-gnu/libc.so.6\n"
    EVIL = "7f20-7f21 r-xp 00000000 08:01 600 /srv/s01/work/evil.so\n"

    def tracked(self, maps, byte_reader=None):
        fp = FakeProc().add(100, 1, 50, exe=CH, args=BROWSER_ARGS, maps=maps)
        tr = fp.tracker(byte_reader=byte_reader)
        tr.tick("smoke")
        return tr.table["100:50"]

    def test_untrusted_mapping_beyond_8_mib_is_stop_not_pass(self):
        lines = obs.MAPS_READ_LIMIT // len(self.PAD) + 10
        maps = CHROME_MAP + LIBC_MAP + self.PAD * lines + self.EVIL
        self.assertGreater(len(maps.encode()), 8 << 20)
        for byte_reader in (None, lambda path, limit: maps.encode()[:limit]):
            r = self.tracked(maps, byte_reader)
            self.assertEqual((r["maps_ok"], r["maps_truncated"]), (0, 1))
            self.assertEqual(r["untrusted_exec_maps"], [])           # never seen
            v, res = run_eval(with_tracked(r))
            self.assertEqual(v, "STOP")
            self.assertIn("MAPPING_EVIDENCE_TRUNCATED", codes(res, "stop"))

    def test_truncation_boundary_and_prefix_evidence(self):
        saved = obs.MAPS_READ_LIMIT
        try:
            complete = CHROME_MAP + LIBC_MAP
            obs.MAPS_READ_LIMIT = len(complete.encode())
            r = self.tracked(complete)                                # exactly at the bound
            self.assertEqual((r["maps_ok"], r["maps_truncated"]), (1, 0))
            self.assertEqual(run_eval(with_tracked(r))[0], "PASS")
            r = self.tracked(complete + VDSO_MAP)                     # one line over
            self.assertEqual((r["maps_ok"], r["maps_truncated"]), (0, 1))
            self.assertEqual(run_eval(with_tracked(r))[0], "STOP")
            # a confirmed untrusted mapping in the complete prefix is still FAIL
            obs.MAPS_READ_LIMIT = len((CHROME_MAP + self.EVIL).encode()) + 5
            r = self.tracked(CHROME_MAP + self.EVIL + LIBC_MAP)
            v, res = run_eval(with_tracked(r))
            self.assertEqual(v, "FAIL")
            self.assertIn("UNTRUSTED_EXECUTABLE_MAPPING", codes(res, "fail"))
            self.assertIn("MAPPING_EVIDENCE_TRUNCATED", codes(res, "stop"))
        finally:
            obs.MAPS_READ_LIMIT = saved

    def test_complete_untrusted_mapping_fails(self):
        r = self.tracked(CHROME_MAP + LIBC_MAP + self.EVIL)
        self.assertEqual((r["maps_ok"], r["maps_truncated"]), (1, 0))
        v, res = run_eval(with_tracked(r))
        self.assertEqual(v, "FAIL")
        self.assertIn("UNTRUSTED_EXECUTABLE_MAPPING", codes(res, "fail"))

    def test_read_is_bounded(self):
        with tempfile.NamedTemporaryFile() as fh:
            fh.write(b"x" * 100)
            fh.flush()
            self.assertEqual(len(obs.read_bytes(fh.name, 11)), 11)


class C3StaticConfig(unittest.TestCase):
    def variant(self, old, new):
        self.assertEqual(PR270_CONFIG.count(old), 1, old)
        return PR270_CONFIG.replace(old, new)

    def test_original_pr270_configuration_is_accepted(self):
        self.assertEqual(obs.check_playwright_config(PR270_CONFIG), [])

    def test_four_reported_invalid_configurations_are_rejected(self):
        variants = {
            "quoted duplicate channel": self.variant(
                'channel: "chrome",\n', 'channel: "chrome",\n        "channel": "msedge",\n'),
            "quoted duplicate chromiumSandbox": self.variant(
                "chromiumSandbox: true,\n",
                'chromiumSandbox: true,\n          "chromiumSandbox": false,\n'),
            "true-true": self.variant("chromiumSandbox: true,\n", "chromiumSandbox: true-true,\n"),
            "additional unnamed project": self.variant(
                "    },\n  ],\n});", "    },\n    { use: { browserName: \"firefox\" } },\n  ],\n});"),
        }
        for name, text in variants.items():
            self.assertTrue(obs.check_playwright_config(text), name)

    def test_further_literal_tricks_are_rejected(self):
        variants = {
            "computed key": ('channel: "chrome",\n', 'channel: "chrome", ["channel"]: "msedge",\n'),
            "shorthand key": ('channel: "chrome",\n', 'channel: "chrome", devices,\n'),
            "numeric key": ('channel: "chrome",\n', 'channel: "chrome", 1: "x",\n'),
            "identifier value": ("chromiumSandbox: true,\n", "chromiumSandbox: devices,\n"),
            "negation": ("chromiumSandbox: true,\n", "chromiumSandbox: !false,\n"),
            "other device": ('...devices["Desktop Chrome"]', '...devices["Desktop Firefox"]'),
            "top-level connectOptions": ('    video: "off",\n',
                                         '    video: "off",\n    connectOptions: { a: 1 },\n'),
            "unknown top-level key": ("  retries: 0,\n", "  retries: 0,\n  globalSetup: \"x\",\n"),
            "quoted top-level duplicate": ("  retries: 0,\n", '  retries: 0,\n  "retries": 1,\n'),
            "project extra key": ('      name: "chromium",\n',
                                  '      name: "chromium",\n      testDir: "x",\n'),
        }
        for name, (old, new) in variants.items():
            self.assertTrue(obs.check_playwright_config(self.variant(old, new)), name)

    def test_literal_parser(self):
        skeleton, strings = obs.js_skeleton('{ a: [1, "s", { b: true }], "c": "d" }')
        members = obs.js_literal_members(skeleton, strings)
        self.assertIn(("a", ("defineConfig(", "{"), 1, ("[",)), members)
        self.assertIn(("#", ("defineConfig(", "{", "a["), 4, ("literal", "1")), members)
        self.assertIn(("#", ("defineConfig(", "{", "a["), 6, ("string", "s")), members)
        self.assertIn(("b", ("defineConfig(", "{", "a[", "{"), 9, ("literal", "true")),
                      members)
        self.assertIn(("c", ("defineConfig(", "{"), 15, ("string", "d")), members)
        for bad in ("{ a: 1 } x", "{ a: 1, a: 2 }", "{ a: b }", "{ a: 1 - 1 }", "{ a }",
                    "{ a: f(1) }", "[1]", "{ ...x }"):
            with self.assertRaises(ValueError, msg=bad):
                obs.js_literal_members(bad, [])


class C3Invariant(unittest.TestCase):
    def test_new_degradations_never_improve_to_pass_nor_hide_a_fail(self):
        degradations = {
            "enumeration failure": lambda t, c: c.update(enumeration_failures=1),
            "unconfirmed freeze": lambda t, c: c.update(ticks_unfrozen=1),
            "unconfirmed thaw": lambda t, c: c.update(thaw_failures=1),
            "truncated maps": lambda t, c: t["browser"].update(maps_truncated=1),
            "late violation": lambda t, c: t["r1"]["sticky"]["cond_age"].update(
                RENDERER_HOLDS_CAPABILITIES=3.0),
            "missing facts": lambda t, c: t["r1"]["sticky"]["cond_age"].update(
                RENDERER_FACTS_MISSING=0.0),
            "early namespace": lambda t, c: t["r1"]["sticky"]["cond_age"].update(
                RENDERER_SHARES_INIT_NET_NAMESPACE=0.1),
        }
        for name, mutate in degradations.items():
            table, ctx = good(), dict(CTX)
            mutate(table, ctx)
            result = obs.evaluate(table, ctx)
            self.assertNotEqual(obs.decide(result["fail"], result["stop"]), "PASS", name)
            table, ctx = good(), dict(CTX)
            table["r1"] = renderer_history({"seccomp": 0}, 5.0)
            mutate(table, ctx)
            result = obs.evaluate(table, ctx)
            self.assertEqual(obs.decide(result["fail"], result["stop"]), "FAIL", name)


OK_RUNS = {"npm_ci": {"exit_code": 0, "timed_out": False},
           "smoke": {"exit_code": 0, "timed_out": False}}


def scripted_tracker(script):
    """A tracker whose successive cgroup.procs reads follow `script`
    (a list of PIDs, a raw string, or an exception per read; then empty)."""
    fp = FakeProc()
    reads = list(script)

    def reader(path, limit=None):
        if not path.endswith("cgroup.procs"):
            return fp.reader(path, limit)
        item = reads.pop(0) if reads else []
        if isinstance(item, Exception):
            raise item
        return item if isinstance(item, str) else "".join("%d\n" % p for p in item)

    tr = fp.tracker()
    tr.reader = reader
    return tr


class C4Base(unittest.TestCase):
    def setUp(self):
        self.saved = obs.CGROUP_DIR
        self.tmp = tempfile.mkdtemp()
        obs.CGROUP_DIR = self.tmp

    def tearDown(self):
        obs.CGROUP_DIR = self.saved

    def q(self, tracker, runs=None, started=True):
        """A qualification at the point where execution has ended."""
        q = make_q(self.tmp)
        q.tracker = tracker
        q.execution_started = started
        q.init_ns = INIT
        q.pre_chrome = {"helper": None}
        q.helper_setuid_capable = False
        q.uid = UID
        if runs is not None:
            q.ev["execution"] = dict(runs)
        return q

    def complete_tracker(self, script=()):
        tr = scripted_tracker(script)
        tr.table = good()
        tr.root_keys = {"smoke": "root"}
        return tr

    @staticmethod
    def verdict(q):
        return obs.decide(q.fails, q.stops)

    @staticmethod
    def stop_codes(q):
        return sorted({s["code"] for s in q.stops})

    @staticmethod
    def run_like_main(q):
        """The part of main() after the preparation phases."""
        try:
            q.execute()
        except obs.Stop as exc:
            q.add_stop(exc.code, exc.detail)
        except Exception as exc:  # noqa: BLE001 - as main() does
            q.add_stop("OBSERVER_INTERNAL_ERROR", "%s: %s" % (type(exc).__name__, exc))
        q.interpret()


class C4EnumerationFailures(C4Base):
    """Fix 1: a failed cgroup.procs read anywhere is persistent STOP evidence."""

    def test_valid_complete_observation_still_passes(self):
        q = self.q(self.complete_tracker(), OK_RUNS)
        q.interpret()
        self.assertEqual((q.fails, q.stops, self.verdict(q)), ([], [], "PASS"))
        self.assertEqual(q.ev["execution_state"]["state"], "complete")
        self.assertEqual(q.ev["observation"]["enumeration_failures"], 0)

    def test_reviewer_case_post_exit_failure_then_clean_cleanup(self):
        # placement [5] -> post-exit PermissionError -> cleanup [] : was PASS
        tr = self.complete_tracker([[5], PermissionError("cgroup.procs"), []])
        q = self.q(tr, OK_RUNS)
        self.assertEqual(tr.pids("placement:smoke"), [5])
        remaining, emptied = q.close_phase("smoke")
        self.assertEqual((remaining, emptied), (None, True))       # cleanup itself verified
        self.assertEqual(tr.enumeration_failures, 1)
        self.assertEqual(tr.enumeration_failure_log,
                         [{"context": "post-exit:smoke", "error": "PermissionError"}])
        q.interpret()
        self.assertEqual(self.verdict(q), "STOP")
        self.assertEqual(self.stop_codes(q), ["PROCESS_ENUMERATION_FAILED"])
        self.assertEqual(q.fails, [])
        self.assertEqual(q.ev["observation"]["enumeration_failure_log"][0]["context"],
                         "post-exit:smoke")

    def test_transient_cleanup_failures_followed_by_successful_cleanup(self):
        tr = self.complete_tracker([OSError("io"), "12\nnot-a-pid\n", [7], []])
        q = self.q(tr, OK_RUNS)
        self.assertTrue(q.kill_cgroup(wait=2, context="cleanup:smoke"))   # ends verified empty
        self.assertEqual(tr.enumeration_failures, 2)
        self.assertEqual([e["error"] for e in tr.enumeration_failure_log],
                         ["OSError", "ValueError"])
        for _ in range(3):                                   # later successes erase nothing
            self.assertEqual(tr.pids(), [])
        self.assertEqual(tr.enumeration_failures, 2)
        q.interpret()
        self.assertEqual(self.verdict(q), "STOP")
        self.assertIn("PROCESS_ENUMERATION_FAILED", self.stop_codes(q))
        self.assertNotIn("TEARDOWN_INCOMPLETE", self.stop_codes(q))

    def test_every_call_site_retains_its_failure(self):
        for context in ("sample:smoke", "placement:smoke", "post-exit:smoke",
                        "cleanup:smoke", "timeout:smoke", "abort:smoke", "teardown"):
            tr = self.complete_tracker([PermissionError("x")])
            self.assertIsNone(tr.pids(context))
            q = self.q(tr, OK_RUNS)
            q.interpret()
            self.assertEqual(self.verdict(q), "STOP", context)
            self.assertEqual(tr.enumeration_failure_log[0]["context"], context)
        tr = self.complete_tracker([PermissionError("x")])
        tr.tick("smoke")                                     # the sampling path itself
        self.assertEqual((tr.enumeration_failures, tr.enumeration_failure_log[0]["context"]),
                         (1, "sample:smoke"))

    def test_unreadable_cgroup_is_never_empty_and_never_cleaned(self):
        tr = scripted_tracker([PermissionError("x")] * 1000)
        q = self.q(tr, OK_RUNS)
        self.assertFalse(q.kill_cgroup(wait=0.12))
        self.assertEqual(q.close_phase("smoke", wait=0.12), (None, False))
        self.assertGreaterEqual(tr.enumeration_failures, 3)
        self.assertLessEqual(len(tr.enumeration_failure_log), 20)       # bounded

    def test_cleanup_only_tracker_failure_is_reported_too(self):
        # execution never started; the tracker only served the teardown
        tr = scripted_tracker([OSError("io"), []])
        q = self.q(tr, started=False)
        self.assertTrue(q.kill_cgroup(wait=2, context="teardown"))
        q.interpret()
        self.assertEqual(self.stop_codes(q), ["EXECUTION_INCOMPLETE",
                                              "PROCESS_ENUMERATION_FAILED"])
        self.assertEqual(self.verdict(q), "STOP")


class C4AbortKeepsEvidence(C4Base):
    """Fix 2: an execution abort never hides what was already observed."""

    def aborting_q(self, abort, unsealed=True, npm_ci_exit=0, abort_in="smoke"):
        """execute() with a fake phase runner: a renderer is sampled at active
        ages 0..3 s, then the phase aborts as `abort` says."""
        clock = Clock()
        thaw_ok = [True]
        fp = FakeProc().add(60, 40, 600, exe=CH, maps=CHROME_MAP,
                            args=("chrome", "--type=renderer"),
                            **{k: v for k, v in SEALED.items() if k not in ("args", "ppid")})
        if unsealed:
            fp.procs[60]["kw"].update(seccomp=0, nnp=0)
        tr = fp.tracker(clock=clock, init_ns=INIT, freeze=lambda: True,
                        thaw=lambda: thaw_ok[0])
        q = self.q(None, started=False)
        q.make_tracker = lambda: tr

        def run_untrusted(argv, phase, timeout):
            if phase != abort_in:
                return {"exit_code": npm_ci_exit, "timed_out": False}
            if abort == "before-observation":
                raise obs.Stop("PRIVILEGE_ISOLATION_FAILED", "child not placed")
            for _ in range(3):
                tr.tick(phase)
                clock.now += 1.0
            if abort == "thaw":
                thaw_ok[0] = False
                tr.tick(phase)                     # sampled at age 3 s, then thaw fails
            elif abort == "crash":
                tr.tick(phase)
                raise RuntimeError("observer bug")
            return {"exit_code": 0, "timed_out": False}
        q.run_untrusted = run_untrusted
        return q, tr

    def test_reviewer_case_violation_then_thaw_failure(self):
        q, tr = self.aborting_q("thaw")
        self.run_like_main(q)
        self.assertEqual(tr.table["60:600"]["sticky"]["cond_age"][
            "RENDERER_SECCOMP_FILTER_ABSENT"], 3.0)
        fail_codes = sorted({f["code"] for f in q.fails})
        self.assertEqual(fail_codes, ["RENDERER_NO_NEW_PRIVS_UNSET",
                                      "RENDERER_SECCOMP_FILTER_ABSENT"])   # was: no findings
        self.assertIn("FREEZER_FAILURE", self.stop_codes(q))               # the abort reason
        self.assertIn("EXECUTION_INCOMPLETE", self.stop_codes(q))
        self.assertEqual(self.verdict(q), "FAIL")
        self.assertEqual(q.ev["execution"]["aborted"]["phase"], "smoke")
        self.assertEqual(q.ev["execution"]["aborted"]["code"], "FREEZER_FAILURE")
        self.assertNotIn("smoke", q.ev["execution"])
        self.assertEqual(q.ev["execution_state"], {
            "state": "aborted", "aborted": q.ev["execution"]["aborted"],
            "process_evidence": "present", "processes_recorded": 1})
        self.assertEqual(q.ev["assessment"]["renderers"]["violating"], ["60:600"])
        self.assertEqual(q.ev["observation"]["unconfirmed_thaws"], 1)

    def test_confirmed_fail_followed_by_other_execution_aborts(self):
        q, _ = self.aborting_q("crash")
        self.run_like_main(q)
        self.assertEqual(self.verdict(q), "FAIL")
        self.assertIn("OBSERVER_INTERNAL_ERROR", self.stop_codes(q))
        self.assertIn("EXECUTION_INCOMPLETE", self.stop_codes(q))
        self.assertEqual(q.ev["execution"]["aborted"]["code"], "OBSERVER_INTERNAL_ERROR")
        self.assertTrue(any(f["code"] == "RENDERER_SECCOMP_FILTER_ABSENT" for f in q.fails))

    def test_abort_without_violation_is_stop_never_pass(self):
        q, _ = self.aborting_q("thaw", unsealed=False)
        self.run_like_main(q)
        self.assertEqual((q.fails, self.verdict(q)), ([], "STOP"))
        self.assertIn("EXECUTION_INCOMPLETE", self.stop_codes(q))
        # even a fully valid recorded process table cannot pass once aborted
        q = self.q(self.complete_tracker(), {"npm_ci": OK_RUNS["npm_ci"], "aborted": {
            "phase": "smoke", "code": "FREEZER_FAILURE", "detail": "x"}})
        q.interpret()
        self.assertEqual((q.fails, self.stop_codes(q), self.verdict(q)),
                         ([], ["EXECUTION_INCOMPLETE"], "STOP"))
        q = self.q(self.complete_tracker(), {"npm_ci": OK_RUNS["npm_ci"]})   # smoke missing
        q.interpret()
        self.assertEqual(self.verdict(q), "STOP")

    def test_abort_before_process_observation_is_stop(self):
        for abort_in in ("npm_ci", "smoke"):
            q, tr = self.aborting_q("before-observation", abort_in=abort_in)
            self.run_like_main(q)
            self.assertEqual((tr.table, q.fails, self.verdict(q)), ({}, [], "STOP"))
            self.assertEqual(self.stop_codes(q), ["EXECUTION_INCOMPLETE", "NO_PROCESS_EVIDENCE",
                                                  "PRIVILEGE_ISOLATION_FAILED"])
            self.assertEqual(q.ev["execution_state"]["process_evidence"], "absent")
            self.assertEqual(q.ev["execution"]["aborted"]["phase"], abort_in)
            self.assertNotIn("assessment", q.ev)

    def test_failed_install_phase_is_recorded_as_abort(self):
        q, _ = self.aborting_q("none", npm_ci_exit=1)
        self.run_like_main(q)
        self.assertEqual(self.verdict(q), "STOP")
        self.assertEqual(q.ev["execution"]["aborted"]["phase"], "npm_ci")
        self.assertIn("SMOKE_FAILED_WITHOUT_PROVEN_VIOLATION", self.stop_codes(q))

    def test_execution_that_never_started_is_stop(self):
        q = self.q(None, started=False)
        q.interpret()
        self.assertEqual((q.fails, self.stop_codes(q), self.verdict(q)),
                         ([], ["EXECUTION_INCOMPLETE"], "STOP"))

    def test_completed_execution_is_unaffected(self):
        q, _ = self.aborting_q("none", unsealed=False)
        self.run_like_main(q)
        self.assertEqual(q.ev["execution_state"]["state"], "complete")
        self.assertNotIn("aborted", q.ev["execution"])
        self.assertNotIn("EXECUTION_INCOMPLETE", self.stop_codes(q))

    def test_main_interprets_even_when_teardown_raises(self):
        with open(OBSERVER) as fh:
            src = fh.read()
        body = src[src.index("    def main(self):"):]
        self.assertLess(body.index("self.teardown()"), body.index("self.interpret()"))
        self.assertLess(body.index("self.interpret()"), body.index("self.seal()"))
        between = body[body.index("self.teardown()"):body.index("self.interpret()")]
        self.assertIn("except Exception", between)      # separate try blocks


class Misc(unittest.TestCase):
    def test_parsers_and_arguments(self):
        text = "42 (a) b) (c) S 7 " + " ".join(str(i) for i in range(5, 60))
        p = obs.parse_stat(text)
        self.assertEqual((p["state"], p["ppid"], p["starttime"]), ("S", 7, 22))
        self.assertEqual(obs.parse_apparmor_label("chrome (unconfined)\n"), ("chrome", "unconfined"))
        self.assertEqual(obs.git_blob_id(b"hello\n"), "ce013625030ba8dba906f756967f9e9ca394464a")
        self.assertEqual(obs.printable("a\n::error::x\x1b"), "a?::error::x?")
        for bad in ("", "/abs", "a/../b", ".git/config", "a//b"):
            self.assertFalse(obs.valid_tree_path(bad), bad)
        base = ["--repository", "o/r", "--run-id", "1", "--run-attempt", "1", "--job", "qualify",
                "--workflow-ref", "refs/heads/main", "--workflow-sha", "a" * 40,
                "--pr-number", "270", "--expected-head-sha", "b" * 40,
                "--expected-tree-sha", "c" * 40, "--trusted-checkout", "/t",
                "--pr-checkout", "/p", "--node-bin-dir", "/n/bin", "--publish-dir", "/tmp/x",
                "--runner-path", "/usr/local/bin:/usr/bin"]
        self.assertEqual(obs.parse_args(base).pr_number, "270")
        old = sys.stderr
        sys.stderr = open(os.devnull, "w")
        try:
            for index, bad in ((11, "A" * 40), (13, "1;id"), (19, "rel/path"), (27, "a\nb")):
                argv = list(base)
                argv[index] = bad
                with self.assertRaises(SystemExit):
                    obs.parse_args(argv)
        finally:
            sys.stderr.close()
            sys.stderr = old

    def test_static_properties_of_the_observer(self):
        with open(OBSERVER) as fh:
            src = fh.read()
        for needle in ("shell=True", "os.system(", "os.chown(", "import requests", "urllib"):
            self.assertNotIn(needle, src, needle)
        self.assertEqual(src.count("os.chmod("), 1)          # only s01u's own new home
        self.assertEqual(src.count("os.execve("), 1)
        order = [src.index('("%s", self.%s)' % (n, n)) for n in
                 ("account", "cgroup", "protect", "chrome_integrity", "source", "isolation",
                  "execute")]
        self.assertEqual(order, sorted(order))


if __name__ == "__main__":
    unittest.main(verbosity=1)
