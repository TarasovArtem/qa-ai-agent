#!/usr/bin/python3
"""S-01 trusted actual-smoke qualification observer.

Runs as root on a GitHub-hosted ubuntu-24.04 runner, started only by
.github/workflows/s01-sandbox-qualification.yml from the default branch.
It measures the Chrome renderer sandbox of ONE real Playwright smoke
(`npm ci` + `npm run test:e2e:playwright`) of an exact PR head/tree.

Three identities, never mixed:
  root    this observer (trusted through its main-branch provenance)
  runner  the Actions agent / artifact publisher (never runs PR code)
  s01u    every PR-controlled process (npm, node, Playwright, Chrome)

Standard library only. No PR-controlled path or executable is ever used
by a privileged operation: the PR source is materialized from git
objects into a fresh root-owned directory and then handed to s01u; every
later read of PR-writable data happens after dropping to s01u.

The hosted runner image makes /opt and /usr/share world-writable
(`chmod -R 777`). Trusted executables that live there (Chrome, the
chrome-sandbox helper, Node/npm, directories on the runner's PATH) are
therefore protected for the qualification window by read-only bind
mounts placed on the topmost world-writable ancestor. Owner, mode bits,
inodes and paths are never changed. This is instrumentation and is
disclosed in the evidence; stock CI does not have it.

Outcomes (exit code): PASS (0), FAIL (1), STOP (2).
A PASS is limited to the observed instrumented run, browser build and
runner image. It certifies nothing else.
"""

import argparse
import ctypes
import errno
import grp
import hashlib
import json
import os
import pwd
import re
import select
import signal
import socket
import stat
import subprocess
import sys
import time

OBSERVER_VERSION = "s01-observer/3"
OBSERVER_REPO_PATH = "scripts/ci/s01_observer.py"

UNTRUSTED_USER = "s01u"
UNTRUSTED_HOME = "/home/s01u"
STATE_ROOT = "/srv/s01"
WORK_DIR = STATE_ROOT + "/work"
EVIDENCE_DIR = "/var/lib/s01-evidence"
CGROUP_ROOT = "/sys/fs/cgroup"
CGROUP_DIR = CGROUP_ROOT + "/s01-qualification"

CHROME_DIR = "/opt/google/chrome"
CHROME_EXE = CHROME_DIR + "/chrome"
CHROME_HELPER = CHROME_DIR + "/chrome-sandbox"
CHROME_PACKAGE = "google-chrome-stable"
ALWAYS_PROTECT = ("/usr/share",)
NEVER_READ_ONLY = ("/", "/tmp", "/var", "/run", "/dev", "/proc", "/sys", "/home", "/etc", "/usr")

TRUSTED_PATH = "/usr/sbin:/usr/bin:/sbin:/bin"
SMOKE_SCRIPT = "test:e2e:playwright"
SMOKE_COMMAND = "playwright test --config=playwright.config.js --project=chromium"
PLAYWRIGHT_CONFIG = "playwright.config.js"

SAMPLE_INTERVAL = 0.05
MAPS_EVERY = 5
FREEZE_WAIT_SECONDS = 1.0
RENDERER_GRACE_SECONDS = 2.0
NPM_CI_TIMEOUT = 600
SMOKE_TIMEOUT = 300
MAX_PROCESSES = 4000
MAX_STATES_PER_PROCESS = 24
MAX_PARENT_ATTEMPTS = 5
MAX_STICKY = 12
MAX_OUTPUT_BYTES = 256 * 1024
MAX_REPORT_BYTES = 512 * 1024
MAX_EVIDENCE_BYTES = 4 * 1024 * 1024
MAX_SOURCE_FILES = 50000
MAX_SOURCE_BYTES = 200 * 1024 * 1024
MAX_CHROME_FILES = 20000
MAX_SCAN_ENTRIES = 2000000

NAMESPACES = ("user", "pid", "net", "mnt", "ipc", "uts", "cgroup")
FAIL_FLAGS = ("--no-sandbox", "--disable-seccomp-filter-sandbox",
              "--disable-namespace-sandbox", "--single-process")
STOP_FLAGS = ("--disable-setuid-sandbox", "--no-zygote")
DRIVER_FLAG = "--remote-debugging-pipe"
STICKY_FLAGS = FAIL_FLAGS + STOP_FLAGS + (DRIVER_FLAG, "--no-zygote-sandbox")
SYSTEM_EXEC_DIRS = ("/usr/bin", "/bin", "/usr/sbin", "/sbin", "/usr/lib/git-core",
                    "/usr/libexec")
BROWSER_NAMES = frozenset((
    "chrome", "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "headless_shell", "chrome-headless-shell", "msedge", "microsoft-edge",
    "firefox", "firefox-bin", "MiniBrowser", "WebKitWebProcess", "pw_run.sh"))
CONFIG_FORBIDDEN = ("no-sandbox", "disable-setuid-sandbox", "disable-seccomp",
                    "disable-namespace-sandbox", "single-process", "no-zygote",
                    "executablePath")

CLONE_NEWUSER = 0x10000000
CLONE_NEWNET = 0x40000000

SCOPE_STATEMENT = (
    "Result applies only to this instrumented run, this Chrome build and "
    "this runner image. Chrome ran as the unprivileged user s01u inside a "
    "tracking cgroup, with world-writable trees holding trusted executables "
    "(/opt, /usr/share and any exposed runner PATH directory) bind-mounted "
    "read-only for the window; stock CI runs it as `runner` without that "
    "protection. A PASS asserts that the only browser executable that ran "
    "in the observer-launched smoke process tree was the verified Chrome "
    "and that its renderers were sandboxed; it does NOT assert that the "
    "test logic drove that browser (exit code and report are written by "
    "PR-controlled code). This does not certify any other run, image, "
    "browser build, or earlier E1/C4 runs."
)


class Stop(Exception):
    """Qualification cannot continue or cannot be concluded."""

    def __init__(self, code, detail=""):
        super().__init__(code)
        self.code = code
        self.detail = str(detail)[:600]


# --------------------------------------------------------------------------
# Pure helpers (unit-testable without privileges)
# --------------------------------------------------------------------------

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def git_blob_id(data, hex_len=40):
    """Object id git assigns to a blob with this content."""
    h = hashlib.sha1() if hex_len == 40 else hashlib.sha256()
    h.update(b"blob %d\x00" % len(data))
    h.update(data)
    return h.hexdigest()


def parse_stat(text):
    """Parse /proc/<pid>/stat; comm may contain spaces and parentheses."""
    rest = text[text.rindex(")") + 2:].split()
    return {"state": rest[0], "ppid": int(rest[1]), "starttime": int(rest[19])}


def parse_status(text):
    raw = {}
    for line in text.splitlines():
        key, sep, value = line.partition(":")
        if sep:
            raw[key.strip()] = value.strip()

    def ints(key):
        return [int(x) for x in raw.get(key, "").split()]

    def one(key):
        value = raw.get(key)
        return int(value.split()[0]) if value else None

    return {
        "uid": ints("Uid"),
        "gid": ints("Gid"),
        "nspid": ints("NSpid"),
        "tracer": one("TracerPid"),
        "cap": {name: raw.get("Cap" + name.capitalize())
                for name in ("inh", "prm", "eff", "bnd", "amb")},
        "seccomp": one("Seccomp"),
        "seccomp_filters": one("Seccomp_filters"),
        "nnp": one("NoNewPrivs"),
    }


def split_cmdline(data, max_args=80, max_len=300):
    args = data.decode("utf-8", "replace").split("\x00")
    if args and args[-1] == "":
        args.pop()
    return [a[:max_len] for a in args[:max_args]]


def has_flag(args, flag):
    return any(a == flag or a.startswith(flag + "=") for a in args)


def parse_apparmor_label(label):
    """'chrome (unconfined)' -> ('chrome', 'unconfined'); 'unconfined' -> (None, 'unconfined')."""
    if label is None:
        return None, None
    label = label.strip().rstrip("\x00").strip()
    if label == "unconfined":
        return None, "unconfined"
    m = re.match(r"^(.*) \(([a-z_]+)\)$", label)
    if m:
        return m.group(1), m.group(2)
    return label, None


def parse_exec_mappings(maps_text):
    """Executable mappings of /proc/<pid>/maps as {(dev, inode, path)}."""
    found = set()
    for line in maps_text.splitlines():
        parts = line.split(None, 5)
        if len(parts) >= 5 and "x" in parts[1]:
            found.add((parts[3], int(parts[4]), parts[5] if len(parts) == 6 else ""))
    return found


def classify_exec_mapping(dev, inode, path, chrome_files, stat_fn=os.stat):
    """Provenance of one executable mapping. Fails closed.

    anonymous   no backing file (vdso, JIT); provenance not applicable
    trusted     backing file re-identified by device+inode AND either
                root-protected or one of the hashed Chrome files
    untrusted   backing file re-identified and writable by a non-root user
    unresolved  deleted/unlinked or otherwise not re-identifiable
    """
    if inode == 0:
        return "anonymous"
    if not path.startswith("/") or path.endswith(" (deleted)"):
        return "unresolved"
    try:
        st = stat_fn(path)
    except OSError:
        return "unresolved"
    actual = "%02x:%02x" % (os.major(st.st_dev), os.minor(st.st_dev))
    if actual != dev or st.st_ino != inode or not stat.S_ISREG(st.st_mode):
        return "unresolved"
    if (st.st_dev, st.st_ino) in chrome_files or is_trusted_file(st):
        return "trusted"
    return "untrusted"


def cap_is_zero(value):
    try:
        return int(value, 16) == 0
    except (TypeError, ValueError):
        return False


def valid_tree_path(path):
    if not path or path.startswith("/") or "\x00" in path:
        return False
    parts = path.split("/")
    return all(p not in ("", ".", "..") and p.lower() != ".git" for p in parts)


def js_skeleton(text):
    """Comments removed and every string literal replaced by \\x01<n>\\x01.

    Returns (skeleton, strings). Raises ValueError for anything that cannot
    be analysed without executing the file (template literals, escapes or
    line breaks inside strings, unterminated constructs).
    """
    out, strings, i, n = [], [], 0, len(text)
    while i < n:
        c = text[i]
        if c in "\"'":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] in "\\\n":
                    raise ValueError("unsupported string literal")
                j += 1
            if j >= n:
                raise ValueError("unterminated string literal")
            out.append("\x01%d\x01" % len(strings))
            strings.append(text[i + 1:j])
            i = j + 1
        elif c in "`\x01":
            raise ValueError("unsupported character or template literal")
        elif text.startswith("//", i):
            j = text.find("\n", i)
            i = n if j < 0 else j
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            if j < 0:
                raise ValueError("unterminated comment")
            i = j + 2
            out.append(" ")
        else:
            out.append(c)
            i += 1
    return "".join(out), strings


_JS_TOKEN = re.compile(r"\x01\d+\x01|[A-Za-z_$][\w$]*|\.\.\.|[^\s]")
_JS_IDENT = re.compile(r"[A-Za-z_$][\w$]*")
_JS_CLOSE = {"{": "}", "[": "]", "(": ")"}


def js_key_paths(skeleton):
    """Property keys and spreads with the path of enclosing brackets.

    Returns [(key, path, token_index, value_token)]. `path` labels each
    enclosing bracket with the property key or callee that introduced it,
    e.g. ("defineConfig(", "{", "projects[", "{", "use{").
    """
    tokens = _JS_TOKEN.findall(skeleton)
    stack, found = [], []
    for index, tok in enumerate(tokens):
        prev = tokens[index - 1] if index >= 1 else ""
        prev2 = tokens[index - 2] if index >= 2 else ""
        if tok in _JS_CLOSE:
            if prev == ":" and _JS_IDENT.fullmatch(prev2):
                stack.append(prev2 + tok)
            elif tok == "(" and _JS_IDENT.fullmatch(prev):
                stack.append(prev + tok)
            else:
                stack.append(tok)
        elif tok in ("}", "]", ")"):
            if not stack or _JS_CLOSE[stack[-1][-1]] != tok:
                raise ValueError("unbalanced brackets")
            stack.pop()
        elif tok == "...":
            found.append(("...", tuple(stack), index, ""))
        elif tok == ":" and _JS_IDENT.fullmatch(prev) and prev2 in ("{", ",") \
                and stack and stack[-1].endswith("{"):
            value = tokens[index + 1] if index + 1 < len(tokens) else ""
            found.append((prev, tuple(stack), index, value))
    if stack:
        raise ValueError("unbalanced brackets")
    return found


def check_playwright_config(text):
    """Static NECESSARY conditions for the Chrome Channel smoke.

    Lexical and structural, not textual: string contents and comments are
    never searched for settings. The file must be exactly

        const { defineConfig, devices } = require("@playwright/test");
        module.exports = defineConfig({ ...plain literal... });

    with one project named "chromium" whose `use` object sets
    channel: "chrome" and launchOptions: { chromiumSandbox: true } and
    nothing else that could change browser selection. The literal may not
    contain calls, assignments, functions or template strings.

    This is still not proof of the effective runtime configuration (the
    PR's test files are executable too). That proof is the observed
    executable identity, flags and kernel facts (see evaluate).
    """
    try:
        skeleton, strings = js_skeleton(text)
        keys = js_key_paths(skeleton)
    except ValueError as exc:
        return ["config is not statically analysable: %s" % exc]

    def string_value(token):
        m = re.fullmatch("\x01(\\d+)\x01", token)
        return strings[int(m.group(1))] if m else None

    problems = []
    form = re.fullmatch(
        r"\s*const\s*\{\s*defineConfig\s*,\s*devices\s*\}\s*=\s*require\(\x01(\d+)\x01\)\s*;"
        r"\s*module\.exports\s*=\s*defineConfig\((.*)\)\s*;?\s*", skeleton, re.S)
    if not form or strings[int(form.group(1))] != "@playwright/test":
        return ["config is not the single `module.exports = defineConfig({...})` form"]
    body = form.group(2)
    if not re.fullmatch(r"[\w$\s{}\[\]:,.\x01-]*", body):
        problems.append("config object contains code (calls, assignments or operators)")
    depth = 0
    for ch in body:
        depth += ch in "{["
        depth -= ch in "}]"
        if depth < 0:
            problems.append("config object is not a single literal")
            break

    base = ("defineConfig(", "{")
    project = base + ("projects[", "{")
    use = project + ("use{",)
    launch = use + ("launchOptions{",)

    def entries(name):
        return [k for k in keys if k[0] == name]

    channel = entries("channel")
    if len(channel) != 1 or channel[0][1] != use or string_value(channel[0][3]) != "chrome":
        problems.append("the chromium project does not set exactly channel: \"chrome\"")
    sandbox = entries("chromiumSandbox")
    if len(sandbox) != 1 or sandbox[0][1] != launch or sandbox[0][3] != "true":
        problems.append("the chromium project does not set exactly "
                        "launchOptions.chromiumSandbox: true")
    names = [k for k in keys if k[0] == "name" and k[1] == project]
    if len(entries("projects")) != 1 or len(names) != 1 \
            or string_value(names[0][3]) != "chromium":
        problems.append("config does not define exactly one project named \"chromium\"")
    if {k[0] for k in keys if k[1] == use} - {"...", "channel", "launchOptions"} \
            or {k[0] for k in keys if k[1] == launch} != {"chromiumSandbox"} \
            or len([k for k in keys if k[0] == "launchOptions"]) != 1 \
            or len([k for k in keys if k[0] == "use" and k[1] == project]) != 1:
        problems.append("the chromium project carries unexpected browser options")
    spreads = entries("...")
    if len(spreads) > 1 or any(
            s[1] != use or (channel and s[2] > channel[0][2]) for s in spreads):
        problems.append("a spread could override the browser selection")
    for token in CONFIG_FORBIDDEN:
        if token in skeleton or any(token in s for s in strings):
            problems.append("config contains forbidden token " + token)
    return problems


def classify_executable(exe, path, chrome_id, chrome_files, node_id, stat_fn=os.stat):
    """Identity class of an executable observed in the tracking cgroup.

    chrome / node    the verified Chrome or Node binary (device+inode)
    chrome_file      another hashed file of the Chrome directory
    system           re-identified, root-protected, in a system directory
                     and not a browser by name
    unexpected       anything else (PR-supplied, deleted, relocated, ...)
    """
    exe = list(exe)
    if exe == list(chrome_id):
        return "chrome"
    if node_id is not None and exe == list(node_id):
        return "node"
    if tuple(exe) in chrome_files:
        return "chrome_file"
    if not path.startswith("/") or path.endswith(" (deleted)"):
        return "unexpected"
    try:
        st = stat_fn(path)
    except OSError:
        return "unexpected"
    if [st.st_dev, st.st_ino] != exe or not stat.S_ISREG(st.st_mode) \
            or not is_trusted_file(st) or os.path.dirname(path) not in SYSTEM_EXEC_DIRS \
            or os.path.basename(path) in BROWSER_NAMES:
        return "unexpected"
    return "system"


def new_sticky():
    """Facts about a process that later observations can never remove."""
    return {"chrome": False, "left_chrome": False, "foreign_browser": False,
            "flags": [], "types": [], "exes": [], "ns": [],
            "tracer": False, "uid0": False, "sealed": False, "regressed": False,
            "overflow": False}


def fold_state(sticky, state, chrome_id):
    """Fold one observed state into the sticky facts. Monotonic."""
    def add(name, value):
        if value not in sticky[name]:
            if len(sticky[name]) >= MAX_STICKY:
                sticky["overflow"] = True
            else:
                sticky[name].append(value)

    args = state.get("cmdline") or []
    add("exes", [state.get("exe"), state.get("exe_path"), state.get("exe_class")])
    if 0 in (state.get("uid") or []):
        sticky["uid0"] = True
    if state.get("exe") == list(chrome_id):
        sticky["chrome"] = True
        for flag in STICKY_FLAGS:
            if has_flag(args, flag):
                add("flags", flag)
        for arg in args:
            if arg.startswith("--type="):
                add("types", arg[7:])
        if state.get("tracer"):
            sticky["tracer"] = True
        ns = state.get("ns") or {}
        add("ns", [ns.get("user"), ns.get("pid"), ns.get("net")])
        if state.get("seccomp") == 2 and state.get("nnp") == 1:
            sticky["sealed"] = True
        elif sticky["sealed"]:
            sticky["regressed"] = True
    else:
        if sticky["chrome"]:
            sticky["left_chrome"] = True
        if has_flag(args, DRIVER_FLAG) or any(
                a.startswith("--type=") and a[7:] in ("renderer", "zygote", "gpu-process")
                for a in args):
            sticky["foreign_browser"] = True


def sticky_of(rec, chrome_id):
    """Union of the stored sticky facts and those derivable from the stored
    states. Deleting either source can therefore never remove a fact."""
    derived = new_sticky()
    states = list(rec.get("states") or [])
    last = rec.get("last_state")
    if last is not None and (not states or states[-1] != last):
        states.append(last)
    for state in states:
        fold_state(derived, state, chrome_id)
    stored = rec.get("sticky") or {}
    for name, value in derived.items():
        other = stored.get(name)
        if isinstance(value, bool):
            derived[name] = value or bool(other)
        else:
            for item in other or []:
                if item not in value:
                    value.append(item)
    return derived


def evaluate(table, ctx):
    """Interpret the observed process table. Pure function.

    ctx: {init_ns, chrome_id, helper_id, node_id, smoke_root, work_dir,
          helper_setuid_capable, untrusted_uid, grace, unsampled,
          table_overflow}

    Supported mechanism (Chromium's Linux namespace sandbox): the browser
    process stays in the init namespaces; it starts a zygote in new
    user+pid+net namespaces; renderers are forked from a zygote, drop all
    capabilities and install seccomp-bpf (Seccomp: 2, NoNewPrivs: 1). The
    setuid-helper layout and any other topology are STOP.

    Evidence is monotonic: sticky facts (Chrome identity, sandbox flags,
    tracing, overflow, ...) survive any later observation, every record
    takes part in the verdict, and missing evidence is a STOP. Nothing
    that is added to an observation can turn it into a PASS.

    Browser-to-smoke binding (what a PASS asserts and what it does not):
    exactly one top-level Chrome ran; its parent is a process running the
    verified Node binary whose PID+start-time lineage reaches the process
    the observer itself started for the smoke, through the process that
    carries the approved `playwright test` command; and no executable of
    unknown identity ran during the smoke. Hence any browser the smoke
    could have used is this one. Whether the test logic actually drove it
    is reported by PR-controlled code and is NOT asserted.
    """
    fails, stops = [], []
    init_ns = ctx["init_ns"]
    chrome_id = list(ctx["chrome_id"])
    helper_id = list(ctx["helper_id"]) if ctx.get("helper_id") else None
    node_id = list(ctx["node_id"]) if ctx.get("node_id") else None
    grace = ctx["grace"]

    def fail(code, detail=""):
        fails.append({"code": code, "detail": str(detail)[:300]})

    def stop(code, detail=""):
        stops.append({"code": code, "detail": str(detail)[:300]})

    sticky = {k: sticky_of(r, chrome_id) for k, r in table.items()}

    def final(rec):
        return rec.get("last_state") or rec["states"][-1]

    def lifetime(rec):
        return rec["last_seen"] - rec["first_seen"]

    def user_ns(key):
        return (final(table[key]).get("ns") or {}).get("user")

    def link_ok(key):
        """Parent bound by PID + start time while both were observed alive."""
        rec = table[key]
        parent = table.get(rec.get("parent_key"))
        if parent is None or not rec.get("parent_confirmed"):
            return None
        birth = rec.get("birth_ppid", rec["states"][0].get("ppid") if rec.get("states") else None)
        return (parent.get("pid") == birth
                and parent.get("starttime", 0) <= rec.get("starttime", 0)
                and parent["first_seen"] <= rec["last_seen"])

    # --- observation completeness: every record and every enumerated PID
    if ctx.get("table_overflow"):
        stop("INCOMPLETE_EVIDENCE", "process table bound exceeded")
    if ctx.get("unsampled"):
        stop("UNSAMPLED_PROCESS", "%d enumerated process(es) without a usable sample, e.g. %s"
             % (len(ctx["unsampled"]), ctx["unsampled"][:3]))
    by_pid = {}
    helper_process_seen = False
    foreign_browsers, unexpected_exes = [], []
    for key, rec in table.items():
        facts = sticky[key]
        if rec.get("overflow") or facts["overflow"]:
            stop("INCOMPLETE_EVIDENCE", "history overflow for " + key)
        if facts["uid0"]:
            # A uid-0 member (e.g. a setuid-root binary started by PR code)
            # is not a proven sandbox violation, but it voids isolation.
            stop("ROOT_PROCESS_IN_UNTRUSTED_CGROUP", key)
        by_pid.setdefault(rec.get("pid"), []).append(rec)
        for exe, path, exe_class in facts["exes"]:
            if helper_id and exe == helper_id:
                helper_process_seen = True
            if exe == chrome_id or exe == helper_id:
                continue
            path = (path or "").replace(" (deleted)", "")
            if os.path.basename(path) in BROWSER_NAMES or "ms-playwright" in path:
                foreign_browsers.append(key)
            if rec.get("phase") == "smoke" and exe != node_id \
                    and exe_class not in ("system", "chrome_file", "node"):
                unexpected_exes.append("%s %s" % (key, path[:120]))
        if facts["foreign_browser"]:
            foreign_browsers.append(key)
    for pid, recs in by_pid.items():
        recs.sort(key=lambda r: r["first_seen"])
        for earlier, later in zip(recs, recs[1:]):
            if later["first_seen"] <= earlier["last_seen"]:
                stop("PID_IDENTITY_AMBIGUOUS", "pid %s observed with two identities" % pid)
    if foreign_browsers:
        stop("UNEXPECTED_BROWSER_SELECTION", "browser-like process that is not the verified "
             "Chrome executable: " + ",".join(sorted(set(foreign_browsers))[:5]))
    if unexpected_exes:
        stop("UNEXPECTED_EXECUTABLE_IN_SMOKE", "; ".join(sorted(set(unexpected_exes))[:4]))

    chrome = {k: r for k, r in table.items() if sticky[k]["chrome"]}
    children = {}
    for key, rec in chrome.items():
        children.setdefault(rec.get("parent_key"), []).append(key)

    browsers, unbound = [], []
    for key, rec in chrome.items():
        ok = link_ok(key)
        if ok is None:
            unbound.append(key)
        elif not ok:
            stop("STALE_PARENT_IDENTITY", key)
            unbound.append(key)
        elif not sticky[rec["parent_key"]]["chrome"]:
            browsers.append(key)
    if unbound:
        stop("AMBIGUOUS_PROCESS_LINEAGE", "chrome without a confirmed parent identity: "
             + ",".join(sorted(unbound)[:5]))

    structural_setuid = False
    for key, rec in chrome.items():
        facts = sticky[key]
        if rec.get("phase") != "smoke":
            stop("CHANGED_WORKFLOW_ASSUMPTIONS",
                 "Chrome process outside the smoke phase: " + key)
        for flag in FAIL_FLAGS:
            if flag in facts["flags"]:
                fail("SANDBOX_DISABLING_FLAG", key + " " + flag)
        for flag in STOP_FLAGS:
            if flag in facts["flags"]:
                stop("CHANGED_BROWSER_ASSUMPTIONS", key + " " + flag)
        if facts["tracer"]:
            stop("TRACED_CHROME_PROCESS", key)
        if facts["left_chrome"]:
            # Only a fork of a Chrome parent that immediately execs a helper
            # is expected to run Chrome and then something else.
            parent = chrome.get(rec.get("parent_key"))
            parent_cmdlines = [s.get("cmdline") for s in (parent or {}).get("states", [])
                               if s.get("exe") == chrome_id]
            own = [s.get("cmdline") for s in rec.get("states", []) if s.get("exe") == chrome_id]
            if facts["types"] or not own or not all(c in parent_cmdlines for c in own):
                stop("AMBIGUOUS_PROCESS_IDENTITY",
                     "process ran Chrome and then another executable: " + key)
        # Executable mapping provenance: fail closed, identity bound.
        if rec.get("untrusted_exec_maps"):
            fail("UNTRUSTED_EXECUTABLE_MAPPING",
                 key + " " + ",".join(rec["untrusted_exec_maps"][:3]))
        if rec.get("unresolved_exec_maps"):
            stop("UNRESOLVED_EXECUTABLE_MAPPING",
                 key + " " + ",".join(rec["unresolved_exec_maps"][:3]))
        if rec.get("maps_identity_changed"):
            stop("MAPPING_IDENTITY_UNSTABLE", key)
        if not rec.get("maps_ok") or rec.get("maps_failed") or rec.get("maps_insufficient"):
            stop("INSUFFICIENT_MAPPING_EVIDENCE",
                 "%s complete=%s failed=%s without_own_executable=%s"
                 % (key, rec.get("maps_ok", 0), rec.get("maps_failed", 0),
                    rec.get("maps_insufficient", 0)))
        for user, pid_ns, _net in facts["ns"]:
            if user == init_ns["user"] and pid_ns and pid_ns != init_ns["pid"]:
                structural_setuid = True

    # --- the one browser, and its binding to the observer-launched smoke
    binding = {"established": False}
    if not browsers:
        stop("NO_BROWSER_OBSERVED")
    elif len(browsers) > 1:
        stop("AMBIGUOUS_BROWSER_IDENTIFICATION", ",".join(sorted(browsers)[:5]))
    else:
        bkey = browsers[0]
        brec = chrome[bkey]
        b = final(brec)
        if (b.get("ns") or {}).get("user") != init_ns["user"]:
            stop("UNSUPPORTED_SANDBOX_INTERPRETATION",
                 "browser process is not in the init user namespace")
        if set(b.get("uid") or []) != {ctx["untrusted_uid"]}:
            stop("CHANGED_WORKFLOW_ASSUMPTIONS", "browser uid is not s01u")
        if b.get("apparmor") is None:
            stop("INCOMPLETE_EVIDENCE", "browser AppArmor label unreadable")
        if DRIVER_FLAG not in sticky[bkey]["flags"] or sticky[bkey]["types"]:
            stop("UNEXPECTED_BROWSER_SELECTION",
                 "browser process is not a Playwright-driven top-level Chrome")

        problem, chain, command = None, [], None
        expected_script = (ctx.get("work_dir") or "") + "/node_modules/.bin/playwright"
        expected_args = SMOKE_COMMAND.split()[1:]
        cur, seen = brec.get("parent_key"), set()
        while cur in table and cur not in seen:
            if sticky[cur]["chrome"]:
                problem = "a Chrome process is among the browser's ancestors"
                break
            chain.append(cur)
            seen.add(cur)
            args = final(table[cur]).get("cmdline") or []
            if final(table[cur]).get("exe") == node_id and args[1:2] == [expected_script] \
                    and args[2:] == expected_args:
                command = cur
            if cur == ctx.get("smoke_root"):
                break
            if not link_ok(cur):
                problem = "unconfirmed or stale ancestry link at " + cur
                break
            cur = table[cur].get("parent_key")
        if problem is None:
            launcher = table[chain[0]] if chain else None
            if node_id is None or not ctx.get("smoke_root"):
                problem = "observer did not supply the Node identity or the smoke root process"
            elif not chain or chain[-1] != ctx["smoke_root"]:
                problem = "ancestry does not reach the process the observer started for the smoke"
            elif final(launcher).get("exe") != node_id or sticky[chain[0]]["overflow"] \
                    or launcher.get("overflow"):
                problem = "the browser's parent does not run the verified Node executable"
            elif command is None:
                problem = "the approved `playwright test` command process is not an ancestor"
            elif any(table[k].get("phase") != "smoke" for k in chain):
                problem = "ancestry leaves the smoke phase"
        binding = {
            "established": problem is None,
            "browser": bkey,
            "ancestry_to_smoke_root": chain,
            "launcher": chain[0] if chain else None,
            "launcher_cmdline": (final(table[chain[0]]).get("cmdline") or [])[:6] if chain else None,
            "approved_command_process": command,
            "smoke_root": ctx.get("smoke_root"),
            "observed_by_kernel_facts": [
                "executable identity (device+inode) of browser and launcher",
                "parent links bound by PID + start time",
                "membership of the tracking cgroup",
                "identity class of every executable run during the smoke"],
            "pr_controlled_and_not_asserted": [
                "command lines (labels only)",
                "that the test logic actually drove this browser",
                "smoke exit code and Playwright report"],
        }
        if problem:
            stop("BROWSER_NOT_BOUND_TO_SMOKE", problem)

    def is_zygote(key):
        facts = sticky[key]
        return ("zygote" in facts["types"] and "renderer" not in facts["types"]
                and "--no-zygote-sandbox" not in facts["flags"]
                and user_ns(key) not in (None, init_ns["user"]))

    def lineage_problem(key):
        """None when the renderer descends browser -> zygote(s) -> renderer."""
        zygotes, seen, cur = [], set(), chrome[key].get("parent_key")
        while cur in chrome and cur not in seen and cur not in browsers:
            if not is_zygote(cur):
                return "AMBIGUOUS_RENDERER_IDENTIFICATION", "ancestor is not a sandboxed zygote"
            zygotes.append(cur)
            seen.add(cur)
            cur = chrome[cur].get("parent_key")
        if cur not in browsers or key in unbound or any(z in unbound for z in zygotes):
            return "AMBIGUOUS_RENDERER_IDENTIFICATION", "renderer outside the browser lineage"
        if not zygotes:
            return ("UNSUPPORTED_SANDBOX_INTERPRETATION",
                    "renderer is a direct child of the browser (no zygote evidence)")
        if any(user_ns(z) != user_ns(key) for z in zygotes):
            return ("UNSUPPORTED_SANDBOX_INTERPRETATION",
                    "renderer and zygote are in different user namespaces")
        return None

    renderers = {"qualified": [], "indeterminate": [], "violating": [], "unsupported": []}
    for key, rec in sorted(chrome.items()):
        facts = sticky[key]
        st = final(rec)
        ns = st.get("ns") or {}
        in_user = ns.get("user") != init_ns["user"]
        in_pid = ns.get("pid") != init_ns["pid"]
        in_net = ns.get("net") != init_ns["net"]
        cap = st.get("cap") or {}
        complete = bool(st.get("exe") == chrome_id
                        and all(ns.get(n) for n in ("user", "pid", "net"))
                        and st.get("seccomp") is not None and st.get("nnp") is not None
                        and cap.get("eff") is not None and cap.get("prm") is not None
                        and st.get("apparmor") is not None and st.get("nspid"))
        sealed = bool(complete and in_user and in_pid and in_net
                      and st.get("seccomp") == 2 and st.get("nnp") == 1
                      and cap_is_zero(cap.get("eff")) and cap_is_zero(cap.get("prm"))
                      and len(st.get("nspid")) >= 2)

        if "renderer" not in facts["types"]:
            # Anti-decoy / replacement: an unsealed sandbox-namespace Chrome
            # leaf may be a renderer that never announced itself.
            if ns.get("user") and in_user and not sealed and not children.get(key):
                stop("AMBIGUOUS_RENDERER_IDENTIFICATION",
                     "unlabelled unsealed sandbox-namespace leaf " + key)
            continue

        problem = lineage_problem(key)
        if problem:
            stop(problem[0], problem[1] + " " + key)
        if not complete:
            stop("INCOMPLETE_RENDERER_HISTORY", "missing kernel facts for " + key)
            renderers["indeterminate"].append(key)
            continue
        if not in_user and (in_pid or in_net):
            stop("UNSUPPORTED_SANDBOX_INTERPRETATION",
                 "renderer in init user namespace with other namespaces "
                 "(setuid-helper layout) " + key)
            renderers["unsupported"].append(key)
            continue

        violations = ["RENDERER_SANDBOX_REGRESSED"] if facts["regressed"] else []
        if not sealed and lifetime(rec) < grace and not violations:
            # Never resolve an unfinished observation in either direction.
            stop("INCOMPLETE_RENDERER_HISTORY",
                 "renderer observed for %.2fs and not sealed: %s" % (lifetime(rec), key))
            renderers["indeterminate"].append(key)
            continue
        if not sealed:
            if not in_user:
                violations.append("RENDERER_NOT_NAMESPACED")
            else:
                if not in_pid:
                    violations.append("RENDERER_SHARES_INIT_PID_NAMESPACE")
                if not in_net:
                    violations.append("RENDERER_SHARES_INIT_NET_NAMESPACE")
                if st.get("seccomp") != 2:
                    violations.append("RENDERER_SECCOMP_FILTER_ABSENT")
                if st.get("nnp") != 1:
                    violations.append("RENDERER_NO_NEW_PRIVS_UNSET")
                if not (cap_is_zero(cap.get("eff")) and cap_is_zero(cap.get("prm"))):
                    violations.append("RENDERER_HOLDS_CAPABILITIES")
                if len(st.get("nspid")) < 2:
                    violations.append("RENDERER_PID_NAMESPACE_INCONSISTENT")
        for code in violations:
            fail(code, key)
        if violations:
            renderers["violating"].append(key)
        elif problem:
            renderers["unsupported"].append(key)
        else:
            renderers["qualified"].append(key)

    if not renderers["qualified"] and not renderers["violating"]:
        stop("NO_QUALIFIED_RENDERER_OBSERVED",
             "indeterminate=%d unsupported=%d"
             % (len(renderers["indeterminate"]), len(renderers["unsupported"])))

    helper_used = helper_process_seen or structural_setuid
    if helper_used:
        stop("UNSUPPORTED_SANDBOX_INTERPRETATION",
             "setuid helper path indicated (process_seen=%s structural=%s)"
             % (helper_process_seen, structural_setuid))
    setuid_helper = {
        "determination": "INDICATED" if helper_used else "NOT_USED",
        "helper_setuid_capable": bool(ctx.get("helper_setuid_capable")),
        "helper_process_seen": helper_process_seen,
        "structural_indicator": structural_setuid,
    }

    labels = set()
    for key in browsers + renderers["qualified"]:
        labels.add(final(chrome[key]).get("apparmor"))
    parsed = [parse_apparmor_label(x) for x in labels if x is not None]
    confinement = bool(parsed) and len(parsed) == len(labels) and all(
        profile and mode == "enforce" for profile, mode in parsed)
    apparmor = {
        "labels_browser_and_qualified_renderers": sorted(x or "<unreadable>" for x in labels),
        "confinement_established": confinement,
        "interpretation": (
            "Attached profile(s) in enforce mode." if confinement else
            "AppArmor confinement NOT established: a profile that is absent, "
            "unconfined-mode or complain-mode is not counted as a sandbox "
            "layer. Profile presence only explains why user namespaces are "
            "permitted."),
    }

    return {
        "fail": fails,
        "stop": stops,
        "summary": {
            "chrome_process_count": len(chrome),
            "browser": browsers,
            "browser_is_verified_chrome_executable": len(browsers) == 1 and not foreign_browsers,
            "browser_binding": binding,
            "zygotes": sorted(k for k in chrome if is_zygote(k)),
            "renderers": renderers,
            "setuid_helper": setuid_helper,
            "apparmor": apparmor,
        },
    }


def printable(text):
    """Single-line ASCII for the job log (no workflow-command injection)."""
    return re.sub(r"[^\x20-\x7e]", "?", str(text))[:700]


def decide(fails, stops):
    if fails:
        return "FAIL"
    if stops:
        return "STOP"
    return "PASS"


# --------------------------------------------------------------------------
# Small system helpers
# --------------------------------------------------------------------------

def read_text(path, limit=1 << 20):
    with open(path, "rb") as fh:
        return fh.read(limit).decode("utf-8", "replace")


def read_optional(path, limit=4096):
    try:
        return read_text(path, limit).strip()
    except OSError:
        return None


def is_trusted_file(st):
    """Root-owned and not writable by anyone except root (or root's group)."""
    if st.st_uid != 0 or st.st_mode & stat.S_IWOTH:
        return False
    return not (st.st_mode & stat.S_IWGRP and st.st_gid != 0)


def within(path, root):
    return path == root or path.startswith(root.rstrip("/") + "/")


def mode_writable(st, uid):
    """Writable by a user with this uid and no supplementary groups (mode bits)."""
    return st.st_uid == uid or bool(st.st_mode & stat.S_IWOTH)


def mount_entries(path, text=None):
    """Mount options of every mount stacked at `path`, oldest first."""
    if text is None:
        text = read_text("/proc/self/mountinfo", 8 << 20)
    fields = (line.split() for line in text.splitlines())
    return [f[5].split(",") for f in fields if len(f) > 5 and f[4] == path]


def submounts(path, text):
    fields = (line.split() for line in text.splitlines())
    return sorted({f[4] for f in fields if len(f) > 5 and f[4].startswith(path.rstrip("/") + "/")})


def exposure(path, uid, lstat=os.lstat):
    """How a user with `uid` (no groups) could tamper with `path` by pathname.

    Returns ("unreachable", None) when an ancestor denies traversal,
    ("writable", top) with the topmost writable ancestor-or-self, or
    ("closed", None). Mode-bit based; real access probes confirm later.
    """
    parts = [p for p in path.split("/") if p]
    prefixes = ["/"] + ["/" + "/".join(parts[:i + 1]) for i in range(len(parts))]
    for index, prefix in enumerate(prefixes):
        st = lstat(prefix)
        if mode_writable(st, uid):
            return "writable", prefix
        if index < len(prefixes) - 1 and st.st_uid != uid and not st.st_mode & stat.S_IXOTH:
            return "unreachable", None
    return "closed", None


_TOOLS = {}


def tool(name):
    if name not in _TOOLS:
        for directory in TRUSTED_PATH.split(":"):
            candidate = os.path.join(directory, name)
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                real = os.path.realpath(candidate)
                if not is_trusted_file(os.stat(real)):
                    raise Stop("MISSING_RUNNER_PREREQUISITE",
                               "tool not root-protected: " + real)
                _TOOLS[name] = real
                break
        else:
            raise Stop("MISSING_RUNNER_PREREQUISITE", "tool not found: " + name)
    return _TOOLS[name]


def trusted_env():
    return {"PATH": TRUSTED_PATH, "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8",
            "HOME": "/root"}


def run(argv, timeout=120, stdin=None):
    """Run a trusted tool as root with a fixed environment."""
    return subprocess.run(argv, input=stdin, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, env=trusted_env(),
                          timeout=timeout, cwd="/", check=False)


def git(repo, *args, timeout=120):
    env = trusted_env()
    env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
                "GIT_CONFIG_SYSTEM": "/dev/null", "GIT_TERMINAL_PROMPT": "0",
                "GIT_OPTIONAL_LOCKS": "0"})
    argv = [tool("git"), "-c", "safe.directory=" + repo,
            "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null",
            "-C", repo] + list(args)
    return subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          env=env, timeout=timeout, cwd="/", check=False)


def git_value(repo, *args):
    proc = git(repo, *args)
    if proc.returncode != 0:
        raise Stop("IDENTITY_DRIFT", "git %s failed: %s"
                   % (" ".join(args), proc.stderr.decode("utf-8", "replace")[:200]))
    return proc.stdout.decode("utf-8", "replace").strip()


def drop_privileges(uid, gid):
    os.setgroups([])
    os.setresgid(gid, gid, gid)
    os.setresuid(uid, uid, uid)
    if os.getresuid() != (uid, uid, uid) or os.getresgid() != (gid, gid, gid) \
            or os.getgroups() not in ([], [gid]):
        os._exit(97)


def as_untrusted(uid, gid, fn, timeout=60, cap=2 * 1024 * 1024):
    """Run trusted function `fn` in a child that has dropped to s01u.

    Returns its JSON-serializable result. Used for real access probes and
    for reading PR-writable data without root ever touching the path.
    """
    rfd, wfd = os.pipe()
    pid = os.fork()
    if pid == 0:
        code = 0
        try:
            os.close(rfd)
            os.environ.clear()
            os.environ["PATH"] = TRUSTED_PATH
            drop_privileges(uid, gid)
            payload = json.dumps({"ok": fn()}).encode()
        except BaseException as exc:  # noqa: BLE001 - child must never unwind
            payload = json.dumps({"error": "%s: %s" % (type(exc).__name__, exc)}).encode()
            code = 3
        try:
            view = memoryview(payload[:cap])
            while view:
                view = view[os.write(wfd, view):]
        finally:
            os._exit(code)
    os.close(wfd)
    chunks, total, deadline = [], 0, time.monotonic() + timeout
    try:
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                os.kill(pid, signal.SIGKILL)
                raise Stop("PRIVILEGE_ISOLATION_FAILED", "unprivileged probe timed out")
            ready, _, _ = select.select([rfd], [], [], remaining)
            if not ready:
                continue
            chunk = os.read(rfd, 65536)
            if not chunk:
                break
            total += len(chunk)
            if total <= cap:
                chunks.append(chunk)
    finally:
        os.close(rfd)
        os.waitpid(pid, 0)
    try:
        result = json.loads(b"".join(chunks).decode("utf-8", "replace"))
    except ValueError:
        raise Stop("PRIVILEGE_ISOLATION_FAILED", "unprivileged probe returned no result")
    if "error" in result:
        raise Stop("PRIVILEGE_ISOLATION_FAILED", "unprivileged probe: " + result["error"])
    return result["ok"]


def probe_writable(path):
    """Called as s01u. True when the path can actually be written."""
    try:
        st = os.stat(path)
    except OSError:
        return False
    if stat.S_ISDIR(st.st_mode):
        probe = os.path.join(path, ".s01-probe-%d" % os.getpid())
        try:
            fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except OSError:
            return False
        os.close(fd)
        os.unlink(probe)
        return True
    try:
        # No O_TRUNC / O_CREAT: opening proves access without modifying.
        fd = os.open(path, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return False
    os.close(fd)
    return True


def probe_readable(path):
    """Called as s01u. True when the file can actually be opened for reading."""
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        return False
    os.close(fd)
    return True


def scan_reachable_writable(root, uid, limit=MAX_SCAN_ENTRIES, max_findings=20):
    """Entries under `root` that `uid` (no groups) could reach and write.

    Mode-bit based (POSIX ACLs are not evaluated). A directory without
    other-execute cannot be traversed by that user and is not descended.
    """
    findings, count = [], 0
    path = os.path.abspath(root)
    probe = path
    while True:
        parent = os.path.dirname(probe)
        if parent == probe:
            break
        st = os.stat(parent)
        if st.st_uid != uid and not st.st_mode & stat.S_IXOTH:
            return [], count, False
        # A writable non-sticky ancestor would allow replacing the path.
        if st.st_uid == uid or (st.st_mode & stat.S_IWOTH and not st.st_mode & stat.S_ISVTX):
            findings.append(parent)
        probe = parent

    try:
        st = os.lstat(path)
    except OSError:
        return findings, count, True
    if mode_writable(st, uid):
        findings.append(path)
    stack = [path] if stat.S_ISDIR(st.st_mode) and (
        st.st_uid == uid or st.st_mode & stat.S_IXOTH) else []
    while stack:
        directory = stack.pop()
        try:
            entries = list(os.scandir(directory))
        except OSError:
            continue
        for entry in entries:
            count += 1
            if count > limit:
                raise Stop("PRIVILEGE_ISOLATION_FAILED",
                           "protected-path scan exceeded bound under " + root)
            try:
                est = entry.stat(follow_symlinks=False)
            except OSError:
                continue
            if stat.S_ISLNK(est.st_mode):
                continue
            if mode_writable(est, uid) and len(findings) < max_findings:
                findings.append(entry.path)
            if stat.S_ISDIR(est.st_mode) and (
                    est.st_uid == uid or est.st_mode & stat.S_IXOTH):
                stack.append(entry.path)
    return findings, count, True


def file_identity(path):
    try:
        st = os.lstat(path)
    except OSError:
        return None
    return {"path": path, "type": stat.S_IFMT(st.st_mode), "mode": oct(stat.S_IMODE(st.st_mode)),
            "uid": st.st_uid, "gid": st.st_gid, "size": st.st_size,
            "dev": st.st_dev, "ino": st.st_ino}


def sha256_file(path):
    h = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def hash_tree(root, max_files=MAX_CHROME_FILES):
    """Aggregate digest over names, types, modes, owners and contents.

    Also returns the (device, inode) identities of the regular files.
    """
    lines, count, identities = [], 0, set()
    for directory, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames.sort()
        for name in sorted(dirnames + filenames):
            full = os.path.join(directory, name)
            st = os.lstat(full)
            count += 1
            if count > max_files:
                raise Stop("CHROME_INTEGRITY_BOUNDARY_UNSATISFIED",
                           "Chrome directory exceeds file bound")
            if stat.S_ISLNK(st.st_mode):
                content = "link:" + os.readlink(full)
            elif stat.S_ISREG(st.st_mode):
                content = "sha256:" + sha256_file(full)
                identities.add((st.st_dev, st.st_ino))
            elif stat.S_ISDIR(st.st_mode):
                content = "dir"
            else:
                content = "other"
            lines.append("%s\x00%o\x00%d\x00%d\x00%s" % (
                os.path.relpath(full, root), st.st_mode, st.st_uid, st.st_gid, content))
    return sha256_bytes("\n".join(sorted(lines)).encode()), count, identities


def ensure_root_dir(path, mode):
    """Create (or accept an existing, empty, root-protected) directory."""
    if not os.path.lexists(path):
        os.mkdir(path, mode)
    st = os.lstat(path)
    if not stat.S_ISDIR(st.st_mode) or not is_trusted_file(st) or os.listdir(path):
        raise Stop("INCOMPLETE_EVIDENCE", "directory is not an empty root-protected one: " + path)


# --------------------------------------------------------------------------
# Process observation
# --------------------------------------------------------------------------

def sample_process(pid):
    """One consistent snapshot of a process, or None if it vanished."""
    base = "/proc/%d/" % pid
    try:
        st1 = parse_stat(read_text(base + "stat", 4096))
        if st1["state"] in ("Z", "X"):
            return None
        status = parse_status(read_text(base + "status", 16384))
        with open(base + "cmdline", "rb") as fh:
            cmdline = split_cmdline(fh.read(16384))
        exe_stat = os.stat(base + "exe")
        exe_path = os.readlink(base + "exe")
        ns = {}
        for name in NAMESPACES:
            try:
                ns[name] = os.readlink(base + "ns/" + name)
            except OSError:
                ns[name] = None
        label = read_optional(base + "attr/apparmor/current")
        if label is None:
            label = read_optional(base + "attr/current")
        state = {
            "ppid": st1["ppid"],
            "exe": [exe_stat.st_dev, exe_stat.st_ino],
            "exe_path": exe_path[:300],
            "cmdline": cmdline,
            "uid": status["uid"], "gid": status["gid"],
            "nspid": status["nspid"], "tracer": status["tracer"],
            "cap": status["cap"], "seccomp": status["seccomp"],
            "seccomp_filters": status["seccomp_filters"], "nnp": status["nnp"],
            "ns": ns,
            "uid_map": read_optional(base + "uid_map", 1024),
            "gid_map": read_optional(base + "gid_map", 1024),
            "apparmor": label,
        }
        if parse_stat(read_text(base + "stat", 4096))["starttime"] != st1["starttime"]:
            return None
        return st1["starttime"], state
    except (OSError, ValueError, IndexError):
        return None


class Tracker:
    """Records every process that is ever a member of the tracking cgroup.

    Identity is always PID + start time. Each tick runs with the cgroup
    frozen when the freezer is available, so that enumeration and sampling
    describe one consistent instant. An enumerated PID that cannot be
    sampled is never dropped: it becomes an explicit `unsampled` entry
    unless it is a known process that verifiably exited. Sticky facts are
    kept outside the bounded state history, which is never overwritten.
    """

    def __init__(self, cgroup_dir, chrome_id, untrusted_uid, chrome_files=frozenset(),
                 node_id=None, clock=time.monotonic, sampler=sample_process,
                 reader=read_text, classify=classify_exec_mapping,
                 classify_exe=classify_executable, freeze=None, thaw=None):
        self.cgroup_dir = cgroup_dir
        self.chrome_id = list(chrome_id)
        self.node_id = list(node_id) if node_id else None
        self.untrusted_uid = untrusted_uid
        self.chrome_files = chrome_files
        self.clock = clock
        self.sampler = sampler
        self.reader = reader
        self.classify = classify
        self.classify_exe = classify_exe
        self.freeze = freeze
        self.thaw = thaw
        self.t0 = clock()
        self.table = {}
        self.table_overflow = False
        self.unsampled = []
        self.unsampled_count = 0
        self.root_keys = {}
        self.ticks = 0
        self.ticks_unfrozen = 0
        self._map_class = {}
        self._exe_class = {}

    def pids(self):
        try:
            return [int(x) for x in self.reader(self.cgroup_dir + "/cgroup.procs").split()]
        except OSError:
            return []

    def identify(self, pid):
        """Key (pid:starttime) of a live process, or None."""
        try:
            stat_line = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
        except (OSError, ValueError, IndexError):
            return None
        return "%d:%d" % (pid, stat_line["starttime"])

    def _unsampled(self, pid, now, phase):
        """An enumerated PID gave no usable sample: keep the uncertainty."""
        try:
            stat_line = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
        except (OSError, ValueError, IndexError):
            stat_line = None
        if stat_line is not None and stat_line["state"] in ("Z", "X"):
            key = "%d:%d" % (pid, stat_line["starttime"])
            if key in self.table:
                # A process whose history is already recorded has exited.
                self.table[key]["exit_seen"] = True
                return
            kind = "exited before its first sample"
        elif stat_line is None:
            kind = "vanished after enumeration"
        else:
            kind = "alive but unreadable"
        self.unsampled_count += 1
        if len(self.unsampled) < 50:
            self.unsampled.append({
                "pid": pid, "t": now, "phase": phase, "kind": kind,
                "starttime": stat_line["starttime"] if stat_line else None})

    def _check_maps(self, pid, rec, state):
        """Mapping evidence bound to the PID + start-time identity."""
        try:
            before = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
            text = self.reader("/proc/%d/maps" % pid, 8 << 20)
            after = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
            mappings = parse_exec_mappings(text)
        except (OSError, ValueError, IndexError):
            # A failed read is never a successful verification, and a
            # later successful read does not erase it.
            rec["maps_failed"] += 1
            return
        if before["starttime"] != rec["starttime"] or after["starttime"] != rec["starttime"] \
                or "Z" in (before["state"], after["state"]):
            rec["maps_identity_changed"] += 1
            return
        own_dev = "%02x:%02x" % (os.major(state["exe"][0]), os.minor(state["exe"][0]))
        own_seen = False
        for mapping in sorted(mappings):
            if mapping not in self._map_class:
                self._map_class[mapping] = self.classify(*mapping, self.chrome_files)
            kind = self._map_class[mapping]
            if mapping[0] == own_dev and mapping[1] == state["exe"][1] and kind == "trusted":
                own_seen = True
            if kind in ("untrusted", "unresolved"):
                bucket = rec[kind + "_exec_maps"]
                label = "%s inode %d dev %s" % (mapping[2][:200], mapping[1], mapping[0])
                if label not in bucket and len(bucket) < 8:
                    bucket.append(label)
        if own_seen:
            rec["maps_ok"] += 1
        else:
            # Empty or partial listing: the process's own executable text is
            # not among the verified mappings, so nothing was proven.
            rec["maps_insufficient"] += 1

    def _confirm_parent(self, key, rec):
        """Bind the parent by PID + start time while both are alive."""
        rec["parent_attempts"] += 1
        pid, ppid = rec["pid"], rec["birth_ppid"]
        try:
            child_before = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
            parent = parse_stat(self.reader("/proc/%d/stat" % ppid, 4096))
            child_after = parse_stat(self.reader("/proc/%d/stat" % pid, 4096))
        except (OSError, ValueError, IndexError):
            return
        for child in (child_before, child_after):
            if child["starttime"] != rec["starttime"] or child["ppid"] != ppid:
                return
        if parent["starttime"] > rec["starttime"]:
            rec["parent_stale"] = True
            return
        parent_key = "%d:%d" % (ppid, parent["starttime"])
        if parent_key in self.table and parent_key != key:
            rec["parent_key"] = parent_key
            rec["parent_confirmed"] = True
        else:
            rec["parent_outside_cgroup"] = ppid

    def tick(self, phase):
        frozen = False
        try:
            frozen = bool(self.freeze()) if self.freeze else False
            if not frozen:
                self.ticks_unfrozen += 1
            self._tick(phase)
        finally:
            if self.thaw:
                self.thaw()

    def _tick(self, phase):
        now = round(self.clock() - self.t0, 3)
        self.ticks += 1
        alive = []
        for pid in self.pids():
            sampled = self.sampler(pid)
            if sampled is None:
                self._unsampled(pid, now, phase)
                continue
            starttime, state = sampled
            key = "%d:%d" % (pid, starttime)
            rec = self.table.get(key)
            if rec is None:
                if len(self.table) >= MAX_PROCESSES:
                    self.table_overflow = True
                    continue
                rec = {"pid": pid, "starttime": starttime, "phase": phase,
                       "first_seen": now, "last_seen": now, "samples": 0,
                       "birth_ppid": state["ppid"],
                       "parent_key": None, "parent_confirmed": False,
                       "parent_attempts": 0, "states": [], "last_state": None,
                       "sticky": new_sticky(), "overflow": False,
                       "untrusted_exec_maps": [], "unresolved_exec_maps": [],
                       "maps_ok": 0, "maps_failed": 0, "maps_insufficient": 0,
                       "maps_identity_changed": 0}
                self.table[key] = rec
            alive.append((key, rec))
            exe_key = (state["exe"][0], state["exe"][1], state["exe_path"])
            if exe_key not in self._exe_class:
                self._exe_class[exe_key] = self.classify_exe(
                    state["exe"], state["exe_path"], self.chrome_id,
                    self.chrome_files, self.node_id)
            state["exe_class"] = self._exe_class[exe_key]
            rec["last_seen"] = now
            rec["samples"] += 1
            previous = rec["last_state"]
            changed = previous is None or {k: v for k, v in previous.items() if k != "t"} != state
            if changed:
                # Sticky facts first; the bounded history is never rewritten.
                fold_state(rec["sticky"], state, self.chrome_id)
                rec["last_state"] = dict(state, t=now)
                if len(rec["states"]) < MAX_STATES_PER_PROCESS:
                    rec["states"].append(rec["last_state"])
                else:
                    rec["overflow"] = True
            if state["exe"] == self.chrome_id and (
                    changed or not rec["maps_ok"] or rec["samples"] % MAPS_EVERY == 0):
                self._check_maps(pid, rec, state)
        for key, rec in alive:
            if not rec["parent_confirmed"] and rec["parent_attempts"] < MAX_PARENT_ATTEMPTS:
                self._confirm_parent(key, rec)

    def export(self):
        """Bounded copy for the evidence file. Chrome and every smoke-phase
        process in full; other install-phase processes compact (their sticky
        facts and overflow flag are always kept)."""
        out = {}
        for key, rec in self.table.items():
            if rec["sticky"]["chrome"] or rec["phase"] == "smoke":
                out[key] = rec
            else:
                st = rec["last_state"]
                out[key] = {"pid": rec["pid"], "starttime": rec["starttime"],
                            "phase": rec["phase"], "first_seen": rec["first_seen"],
                            "last_seen": rec["last_seen"], "samples": rec["samples"],
                            "parent_key": rec["parent_key"], "ppid": st["ppid"],
                            "exe_path": st["exe_path"], "uid": st["uid"],
                            "argv": [a[:120] for a in st["cmdline"][:6]],
                            "state_count": len(rec["states"]),
                            "overflow": rec["overflow"], "sticky": rec["sticky"]}
        return out


# --------------------------------------------------------------------------
# The qualification
# --------------------------------------------------------------------------

class Qualification:
    def __init__(self, args):
        self.a = args
        self.fails = []
        self.stops = []
        self.uid = self.gid = None
        self.runner_uid = None
        self.cgroup_created = False
        self.mounted = []          # [(mount point, mount count before)]
        self.ro_roots = []
        self.tracker = None
        self.pre_chrome = None
        self.chrome_files = frozenset()
        self.pre_trusted = {}
        self.output = bytearray()
        self.output_dropped = 0
        self.ev = {
            "observer_version": OBSERVER_VERSION,
            "scope": SCOPE_STATEMENT,
            "started_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "identity": {
                "repository": args.repository, "run_id": args.run_id,
                "run_attempt": args.run_attempt, "job": args.job,
                "workflow_ref": args.workflow_ref, "workflow_sha": args.workflow_sha,
                "pr_number": args.pr_number,
                "expected_head_sha": args.expected_head_sha,
                "expected_tree_sha": args.expected_tree_sha,
            },
            "phases": [],
        }

    # -- bookkeeping -------------------------------------------------------

    def add_stop(self, code, detail=""):
        self.stops.append({"code": code, "detail": str(detail)[:600]})

    def phase(self, name, fn):
        fn()
        self.ev["phases"].append(name)

    def in_ro(self, path):
        return any(within(path, root) for root in self.ro_roots)

    # -- 1. startup and observer integrity ---------------------------------

    def startup(self):
        a = self.a
        if os.geteuid() != 0 or os.getuid() != 0:
            raise Stop("UNTRUSTED_OBSERVER", "observer must run as root")
        if not sys.flags.isolated:
            raise Stop("UNTRUSTED_OBSERVER", "python must run with -I")
        if a.run_attempt != "1":
            raise Stop("IDENTITY_DRIFT", "run attempt is not 1")
        if a.workflow_ref != "refs/heads/main":
            raise Stop("UNTRUSTED_OBSERVER", "workflow ref is not refs/heads/main")
        own = os.path.realpath(__file__)
        st = os.lstat(own)
        parent = os.stat(os.path.dirname(own))
        if not stat.S_ISREG(st.st_mode) or st.st_uid != 0 or st.st_mode & 0o022 \
                or parent.st_uid != 0 or parent.st_mode & 0o077:
            raise Stop("UNTRUSTED_OBSERVER", "observer file is not root-protected")
        interpreter = os.path.realpath(sys.executable)
        if not is_trusted_file(os.stat(interpreter)):
            raise Stop("UNTRUSTED_OBSERVER", "python interpreter is not root-protected")
        with open(own, "rb") as fh:
            data = fh.read()
        head = git_value(a.trusted_checkout, "rev-parse", "HEAD")
        if head != a.workflow_sha:
            raise Stop("UNTRUSTED_OBSERVER", "trusted checkout is not the workflow commit")
        blob = git_value(a.trusted_checkout, "rev-parse",
                         a.workflow_sha + ":" + OBSERVER_REPO_PATH)
        if git_blob_id(data, len(blob)) != blob:
            raise Stop("UNTRUSTED_OBSERVER",
                       "running observer differs from the workflow commit's blob")
        try:
            self.runner_uid = int(os.environ.get("SUDO_UID", ""))
        except ValueError:
            raise Stop("MISSING_RUNNER_PREREQUISITE", "SUDO_UID missing")
        if self.runner_uid == 0:
            raise Stop("MISSING_RUNNER_PREREQUISITE", "invoking user is root")
        self.ev["observer"] = {"path": own, "sha256": sha256_bytes(data),
                               "git_blob": blob, "interpreter": interpreter,
                               "python": sys.version.split()[0],
                               "runner_uid": self.runner_uid}

    # -- 2. host prerequisites and identity --------------------------------

    def host(self):
        a = self.a
        if not os.path.isfile(CGROUP_ROOT + "/cgroup.controllers"):
            raise Stop("MISSING_RUNNER_PREREQUISITE", "cgroup v2 unified hierarchy absent")
        for name in ("git", "useradd", "mount", "umount", "dpkg", "dpkg-query", "sudo"):
            tool(name)
        chrome = file_identity(CHROME_EXE)
        if chrome is None or chrome["type"] != stat.S_IFREG \
                or os.path.realpath(CHROME_EXE) != CHROME_EXE:
            raise Stop("CHANGED_BROWSER_ASSUMPTIONS",
                       CHROME_EXE + " is missing or not a plain file")
        try:
            self.init_ns = {n: os.readlink("/proc/1/ns/" + n) for n in NAMESPACES}
        except OSError as exc:
            raise Stop("MISSING_RUNNER_PREREQUISITE", "cannot read init namespaces: %s" % exc)
        query = run([tool("dpkg-query"), "-W", "-f",
                     "${Version}\t${Status}\t${Maintainer}", CHROME_PACKAGE])
        owner = run([tool("dpkg-query"), "-S", CHROME_EXE])
        if query.returncode != 0 or owner.returncode != 0 or \
                not owner.stdout.decode("utf-8", "replace").startswith(CHROME_PACKAGE + ":"):
            raise Stop("CHANGED_BROWSER_ASSUMPTIONS",
                       CHROME_EXE + " is not owned by " + CHROME_PACKAGE)
        version, status, maintainer = (
            query.stdout.decode("utf-8", "replace").split("\t") + ["", ""])[:3]
        os_release = {}
        for line in (read_optional("/etc/os-release", 4096) or "").splitlines():
            key, sep, value = line.partition("=")
            if sep and key in ("ID", "VERSION_ID", "VERSION_CODENAME"):
                os_release[key] = value.strip('"')
        uname = os.uname()
        self.ev["host"] = {
            "image_os": a.image_os, "image_version": a.image_version,
            "os_release": os_release,
            "kernel": {"release": uname.release, "version": uname.version[:200],
                       "machine": uname.machine},
            "init_ns": self.init_ns,
            "sysctl": {name: read_optional("/proc/sys/" + name.replace(".", "/"))
                       for name in ("kernel.apparmor_restrict_unprivileged_userns",
                                    "kernel.unprivileged_userns_clone",
                                    "kernel.yama.ptrace_scope",
                                    "user.max_user_namespaces")},
            "apparmor": {
                "module_enabled": read_optional("/sys/module/apparmor/parameters/enabled"),
                "loaded_profiles_matching": [
                    line for line in (read_optional(
                        "/sys/kernel/security/apparmor/profiles", 1 << 20) or "").splitlines()
                    if re.search(r"chrome|chromium|unprivileged_userns", line)][:40],
                "chrome_profile_file_sha256": (
                    sha256_file("/etc/apparmor.d/chrome")
                    if os.path.isfile("/etc/apparmor.d/chrome") else None),
            },
            "chrome_package": {"name": CHROME_PACKAGE, "version": version,
                               "status": status, "maintainer": maintainer[:120]},
        }

    # -- 3. untrusted account ----------------------------------------------

    def account(self):
        try:
            pwd.getpwnam(UNTRUSTED_USER)
            raise Stop("PRIVILEGE_ISOLATION_FAILED", "account s01u already exists")
        except KeyError:
            pass
        proc = run([tool("useradd"), "--create-home", "--home-dir", UNTRUSTED_HOME,
                    "--shell", "/usr/sbin/nologin", "--user-group", UNTRUSTED_USER])
        if proc.returncode != 0:
            raise Stop("PRIVILEGE_ISOLATION_FAILED", "useradd failed: %s"
                       % proc.stderr.decode("utf-8", "replace")[:200])
        entry = pwd.getpwnam(UNTRUSTED_USER)
        self.uid, self.gid = entry.pw_uid, entry.pw_gid
        os.chmod(UNTRUSTED_HOME, 0o700)
        memberships = [g.gr_name for g in grp.getgrall() if UNTRUSTED_USER in g.gr_mem]
        groups = os.getgrouplist(UNTRUSTED_USER, self.gid)
        if self.uid in (0, self.runner_uid) or self.gid == 0 \
                or groups != [self.gid] or memberships \
                or grp.getgrgid(self.gid).gr_name != UNTRUSTED_USER:
            raise Stop("PRIVILEGE_ISOLATION_FAILED",
                       "s01u has unexpected identity or supplementary groups")
        self.ev["untrusted_account"] = {"name": UNTRUSTED_USER, "uid": self.uid,
                                        "gid": self.gid, "groups": groups}

    # -- 4. tracking cgroup and protected directories ----------------------

    def cgroup(self):
        if os.path.exists(CGROUP_DIR):
            raise Stop("MISSING_RUNNER_PREREQUISITE", "tracking cgroup already exists")
        os.mkdir(CGROUP_DIR, 0o755)
        self.cgroup_created = True
        for name in ("cgroup.procs", "cgroup.kill"):
            if not os.path.exists(os.path.join(CGROUP_DIR, name)):
                raise Stop("MISSING_RUNNER_PREREQUISITE", name + " unavailable")
        if os.stat(CGROUP_DIR).st_uid != 0:
            raise Stop("MISSING_RUNNER_PREREQUISITE", "tracking cgroup not root-owned")
        # Evidence and state directories exist before the isolation preflight,
        # so that preflight probes the real objects, not their absence.
        for path, mode in ((EVIDENCE_DIR, 0o700), (self.a.publish_dir, 0o755),
                           (STATE_ROOT, 0o755)):
            if os.path.lexists(path):
                raise Stop("PRIVILEGE_ISOLATION_FAILED", "directory already exists: " + path)
            ensure_root_dir(path, mode)

    # -- 5. filesystem protection (before any untrusted execution) ---------

    def agent_paths(self):
        """Directories of runner-owned ancestor executables (the Actions agent)."""
        paths, pid = [], os.getpid()
        for _ in range(32):
            try:
                pid = parse_stat(read_text("/proc/%d/stat" % pid, 4096))["ppid"]
                if pid <= 1:
                    break
                exe = os.path.realpath("/proc/%d/exe" % pid)
                if os.stat("/proc/%d" % pid).st_uid == self.runner_uid:
                    directory = os.path.dirname(exe)
                    if directory not in paths and os.stat(directory).st_uid == self.runner_uid:
                        paths.append(directory)
            except OSError:
                break
        return paths

    def runner_path_dirs(self):
        """Existing directories on the runner's PATH, plus the nearest existing
        ancestor of each missing entry (where a directory could be planted)."""
        existing, anchors = [], []
        for entry in self.a.runner_path.split(":"):
            if not entry.startswith("/"):
                continue
            path = os.path.normpath(entry)
            if os.path.isdir(path):
                existing.append(os.path.realpath(path))
            else:
                while not os.path.isdir(path):
                    path = os.path.dirname(path)
                anchors.append(os.path.realpath(path))
        return sorted(set(existing)), sorted(set(anchors))

    def mount_read_only(self, tree):
        code = "FILESYSTEM_PROTECTION_UNSATISFIED"
        if tree in NEVER_READ_ONLY or any(within(p, tree) for p in self.must_stay_writable) \
                or any(within(tree, p) for p in self.agent_area):
            raise Stop(code, "cannot make read-only without breaking the runner: " + tree)
        if os.path.islink(tree) or not os.path.isdir(tree):
            raise Stop(code, "not a directory: " + tree)
        text = read_text("/proc/self/mountinfo", 8 << 20)
        if submounts(tree, text):
            raise Stop(code, "unsupported layout: mounts below " + tree)
        before = len(mount_entries(tree, text))
        for argv in ([tool("mount"), "--bind", tree, tree],
                     [tool("mount"), "-o", "remount,bind,ro", tree]):
            proc = run(argv)
            if proc.returncode != 0:
                raise Stop(code, "read-only bind mount of %s failed: %s"
                           % (tree, proc.stderr.decode("utf-8", "replace")[:200]))
            if (tree, before) not in self.mounted:
                self.mounted.append((tree, before))
        entries = mount_entries(tree)
        if len(entries) != before + 1 or "ro" not in entries[-1]:
            raise Stop(code, "read-only mount not effective on " + tree)
        self.ro_roots.append(tree)

    def protect(self):
        """Close pathname-replacement and write exposure of trusted trees.

        For Chrome, Node/npm, every runner PATH directory and /usr/share:
        if the user s01u could write the path or any ancestor (mode bits),
        the topmost such directory is bind-mounted read-only. Nothing is
        chmod-ed or chown-ed. Unprotectable exposure is a STOP.
        """
        a = self.a
        node_dir = os.path.realpath(a.node_bin_dir)
        if node_dir != a.node_bin_dir or not all(
                os.path.lexists(os.path.join(node_dir, n)) for n in ("node", "npm")):
            raise Stop("MISSING_RUNNER_PREREQUISITE", "node/npm not found in " + a.node_bin_dir)
        self.node_real = os.path.realpath(os.path.join(node_dir, "node"))
        self.npm_real = os.path.realpath(os.path.join(node_dir, "npm"))
        self.agent_dirs = self.agent_paths()
        self.agent_area = sorted(set(
            [os.path.realpath(p) for p in a.protected_path] + self.agent_dirs))
        self.must_stay_writable = self.agent_area + [
            EVIDENCE_DIR, STATE_ROOT, a.publish_dir, UNTRUSTED_HOME, CGROUP_DIR]
        self.path_dirs, self.path_anchors = self.runner_path_dirs()

        stock_targets = [CHROME_DIR, CHROME_EXE, CHROME_HELPER, self.node_real]
        stock = as_untrusted(self.uid, self.gid,
                             lambda: {p: probe_writable(p) for p in stock_targets})

        targets = [CHROME_DIR, os.path.dirname(self.node_real), os.path.dirname(self.npm_real)]
        targets += list(ALWAYS_PROTECT) + [
            d for d in self.path_dirs if not any(within(d, p) for p in self.agent_area)]
        decisions = {}
        for target in targets:
            if self.in_ro(target):
                decisions[target] = "inside read-only mount"
                continue
            kind, top = exposure(target, self.uid)
            if kind == "closed":
                findings, _, _ = scan_reachable_writable(target, self.uid)
                if findings:
                    kind, top = "writable", target
            if kind == "writable":
                self.mount_read_only(top)
                decisions[target] = "read-only mount at " + top
            else:
                decisions[target] = kind
        self.ev["filesystem_protection"] = {
            "stock_exposure_writable_by_unprivileged_user": stock,
            "decisions": decisions,
            "read_only_mounts": list(self.ro_roots),
            "disclosure": (
                "The runner image makes /opt and /usr/share world-writable. For "
                "the qualification window the listed trees were bind-mounted "
                "read-only. Owner, mode bits (including the non-setuid 0777 "
                "chrome-sandbox helper), inodes and paths were not changed, so "
                "Chrome's sandbox selection and AppArmor path attachment are "
                "the stock ones. Stock CI does not have this protection and "
                "the recorded stock exposure is NOT remediated."),
        }

    # -- 6. Chrome integrity boundary --------------------------------------

    def chrome_snapshot(self):
        digest, count, identities = hash_tree(CHROME_DIR)
        snapshot = {
            "chrome": file_identity(CHROME_EXE),
            "chrome_sha256": sha256_file(CHROME_EXE),
            "helper": file_identity(CHROME_HELPER),
            "helper_sha256": (sha256_file(CHROME_HELPER)
                              if os.path.isfile(CHROME_HELPER)
                              and not os.path.islink(CHROME_HELPER) else None),
            "directory_digest": digest, "directory_entries": count,
        }
        return snapshot, frozenset(identities)

    def chain(self, path):
        """The path and every ancestor directory; each must be protected."""
        chain, cursor = [], path
        while True:
            st = os.lstat(cursor)
            kind = "read-only mount" if self.in_ro(cursor) else (
                "mode" if is_trusted_file(st) else None)
            chain.append({"path": cursor, "mode": oct(stat.S_IMODE(st.st_mode)),
                          "uid": st.st_uid, "gid": st.st_gid, "protected_by": kind})
            if cursor == "/":
                return chain
            cursor = os.path.dirname(cursor)

    def chrome_integrity(self):
        boundary = "CHROME_INTEGRITY_BOUNDARY_UNSATISFIED"
        chain = self.chain(CHROME_DIR)
        for item in chain:
            if item["protected_by"] is None:
                raise Stop(boundary, "ancestor neither root-protected nor read-only: "
                           + item["path"])
        verify = run([tool("dpkg"), "--verify", CHROME_PACKAGE], timeout=300)
        verify_lines = verify.stdout.decode("utf-8", "replace").splitlines()[:50]
        if any(CHROME_DIR + "/" in line for line in verify_lines):
            raise Stop(boundary, "installed Chrome files differ from package database: "
                       + "; ".join(verify_lines[:3]))
        # Real access checks as s01u: files, directory and every ancestor.
        targets = [item["path"] for item in chain] + [CHROME_EXE, CHROME_HELPER]
        protected = as_untrusted(self.uid, self.gid,
                                 lambda: {p: probe_writable(p) for p in targets})
        if any(protected.values()):
            raise Stop(boundary, "s01u can still write: "
                       + ",".join(p for p, w in protected.items() if w))
        self.pre_chrome, self.chrome_files = self.chrome_snapshot()
        helper = self.pre_chrome["helper"]
        self.helper_setuid_capable = bool(
            helper and helper["uid"] == 0 and int(helper["mode"], 8) & stat.S_ISUID)
        self.ev["chrome_integrity"] = {
            "ancestors": chain,
            "dpkg_verify_exit": verify.returncode,
            "dpkg_verify_output": verify_lines,
            "writable_by_s01u_after_protection": protected,
            "before": self.pre_chrome,
            "helper_setuid_capable": self.helper_setuid_capable,
        }

    # -- 7. exact PR source ------------------------------------------------

    def source(self):
        a = self.a
        repo = a.pr_checkout
        head = git_value(repo, "rev-parse", "HEAD")
        tree = git_value(repo, "rev-parse", "HEAD^{tree}")
        if head != a.expected_head_sha or tree != a.expected_tree_sha:
            raise Stop("IDENTITY_DRIFT", "PR checkout head/tree differ from expected inputs")

        listing = git(repo, "ls-tree", "-r", "-z", "--full-tree", a.expected_tree_sha)
        if listing.returncode != 0:
            raise Stop("IDENTITY_DRIFT", "cannot list expected tree")
        entries = []
        for item in listing.stdout.split(b"\x00"):
            if not item:
                continue
            meta, _, raw_path = item.partition(b"\t")
            mode, kind, oid = meta.decode().split()
            path = raw_path.decode("utf-8", "surrogateescape")
            if kind != "blob" or mode not in ("100644", "100755", "120000"):
                raise Stop("UNSUPPORTED_SOURCE", "unsupported tree entry: %s %s" % (mode, kind))
            if not valid_tree_path(path):
                raise Stop("UNSUPPORTED_SOURCE", "unsafe path in tree")
            entries.append((mode, oid, path))
        if not entries or len(entries) > MAX_SOURCE_FILES:
            raise Stop("UNSUPPORTED_SOURCE", "tree entry count out of bounds")

        # Fresh root-owned staging area; nothing untrusted has run yet.
        ensure_root_dir(STATE_ROOT, 0o755)
        os.mkdir(WORK_DIR, 0o755)
        env = trusted_env()
        env.update({"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": "/dev/null",
                    "GIT_CONFIG_SYSTEM": "/dev/null", "GIT_OPTIONAL_LOCKS": "0"})
        batch = subprocess.Popen(
            [tool("git"), "-c", "safe.directory=" + repo, "-C", repo, "cat-file", "--batch"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            env=env, cwd="/")
        total = 0
        captured = {}
        keep = ("package.json", "package-lock.json", PLAYWRIGHT_CONFIG)
        try:
            for mode, oid, path in entries:
                batch.stdin.write(oid.encode() + b"\n")
                batch.stdin.flush()
                header = batch.stdout.readline().split()
                if len(header) != 3 or header[1] != b"blob":
                    raise Stop("IDENTITY_DRIFT", "object missing for tree entry")
                size = int(header[2])
                total += size
                if total > MAX_SOURCE_BYTES:
                    raise Stop("UNSUPPORTED_SOURCE", "source exceeds size bound")
                data = batch.stdout.read(size)
                batch.stdout.read(1)
                if len(data) != size or git_blob_id(data, len(oid)) != oid:
                    raise Stop("IDENTITY_DRIFT", "blob content does not match tree entry")
                dest = os.path.join(WORK_DIR, path)
                parent = os.path.dirname(dest)
                os.makedirs(parent, 0o755, exist_ok=True)
                if os.path.realpath(parent) != parent:
                    raise Stop("UNSUPPORTED_SOURCE", "path escapes work directory")
                if mode == "120000":
                    os.symlink(os.fsdecode(data), dest)
                else:
                    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o755 if mode == "100755" else 0o644)
                    with os.fdopen(fd, "wb") as fh:
                        fh.write(data)
                if path in keep and mode != "120000":
                    captured[path] = data
        finally:
            batch.stdin.close()
            batch.kill()
            batch.wait()

        os.lchown(WORK_DIR, self.uid, self.gid)
        for directory, dirnames, filenames in os.walk(WORK_DIR, followlinks=False):
            for name in dirnames + filenames:
                os.lchown(os.path.join(directory, name), self.uid, self.gid)

        info = {"materialized_from": "git objects of the expected tree (no checkout filters)",
                "files": len(entries), "bytes": total, "head": head, "tree": tree}
        try:
            package = json.loads(captured["package.json"])
            info["smoke_script"] = str(package.get("scripts", {}).get(SMOKE_SCRIPT))[:300]
            lock = json.loads(captured["package-lock.json"]).get("packages", {})
            info["playwright"] = {
                name: {"version": lock.get("node_modules/" + name, {}).get("version"),
                       "integrity": lock.get("node_modules/" + name, {}).get("integrity")}
                for name in ("@playwright/test", "playwright", "playwright-core")}
            config = captured[PLAYWRIGHT_CONFIG]
        except (KeyError, ValueError, AttributeError) as exc:
            raise Stop("CHANGED_WORKFLOW_ASSUMPTIONS", "cannot read smoke definition: %s" % exc)
        info["playwright_config_sha256"] = sha256_bytes(config)
        self.ev["source"] = info
        # Bind the target smoke: exact existing script and a config that at
        # least requests Chrome Channel with the Chromium sandbox. The config
        # bytes come from the verified tree and are only read, never executed
        # by the observer. Effective selection is proven later by the observed
        # executable identity, not by this text check.
        if info["smoke_script"] != SMOKE_COMMAND:
            raise Stop("CHANGED_WORKFLOW_ASSUMPTIONS",
                       "smoke script is not the approved command")
        problems = check_playwright_config(config.decode("utf-8", "replace"))
        info["playwright_config_static_check"] = problems or "channel chrome + chromiumSandbox true"
        if problems:
            raise Stop("UNEXPECTED_BROWSER_SELECTION", "; ".join(problems))

    # -- 8. privilege isolation preflight (last step before PR code) -------

    def child_env(self):
        return {
            "PATH": self.a.node_bin_dir + ":/usr/local/bin:/usr/bin:/bin",
            "HOME": UNTRUSTED_HOME, "USER": UNTRUSTED_USER, "LOGNAME": UNTRUSTED_USER,
            "SHELL": "/bin/bash", "LANG": "C.UTF-8",
            "CI": "true", "GITHUB_ACTIONS": "true", "CYPRESS_INSTALL_BINARY": "0",
        }

    def isolation(self):
        a = self.a
        code = "PRIVILEGE_ISOLATION_FAILED"
        observer_dir = os.path.dirname(os.path.realpath(__file__))
        node_tree = os.path.dirname(os.path.dirname(self.node_real))
        protected = sorted(set(
            [observer_dir, EVIDENCE_DIR, a.publish_dir, os.path.dirname(a.publish_dir),
             node_tree, os.path.dirname(self.npm_real)]
            + self.agent_area + self.path_dirs))

        scans = {}
        for path in protected:
            if self.in_ro(path):
                scans[path] = {"protected_by": "read-only mount"}
                continue
            findings, count, reachable = scan_reachable_writable(path, self.uid)
            scans[path] = {"protected_by": "mode bits", "entries": count,
                           "reachable_by_s01u": reachable, "writable": findings}
            if findings:
                raise Stop(code, "s01u-writable entries under protected path: "
                           + ", ".join(findings[:3]))

        # Every trusted executable and each of its ancestors must be protected.
        chains = {}
        for path in (self.node_real, self.npm_real):
            chains[path] = self.chain(path)
            bad = [i["path"] for i in chains[path] if i["protected_by"] is None]
            if bad:
                raise Stop("FILESYSTEM_PROTECTION_UNSATISFIED",
                           "trusted executable path not protected: " + ", ".join(bad[:3]))
        self.pre_trusted = {p: sha256_file(p) for p in (self.node_real, self.npm_real)}

        sudo, env = tool("sudo"), {"PATH": TRUSTED_PATH}
        probe_targets = sorted(set(
            protected + self.path_anchors + list(self.ro_roots)
            + [i["path"] for c in chains.values() for i in c]
            + [STATE_ROOT, CGROUP_DIR, CGROUP_DIR + "/cgroup.procs",
               CGROUP_ROOT + "/cgroup.procs", os.path.dirname(STATE_ROOT),
               os.path.dirname(EVIDENCE_DIR)]))
        credential_files = sorted({
            os.path.join(base, name)
            for directory in self.agent_dirs
            for base in (directory, os.path.dirname(directory),
                         os.path.dirname(os.path.dirname(directory)))
            for name in (".credentials", ".credentials_rsaparams")})
        sockets = ["/var/run/docker.sock", "/run/docker.sock",
                   "/run/containerd/containerd.sock"]

        def probes():
            result = {"resuid": list(os.getresuid()), "resgid": list(os.getresgid()),
                      "groups": os.getgroups()}
            proc = subprocess.run([sudo, "-n", "true"], env=env, stdin=subprocess.DEVNULL,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                  timeout=30, check=False)
            result["sudo_exit"] = proc.returncode
            result["writable"] = [p for p in probe_targets if probe_writable(p)]
            result["readable_credentials"] = [p for p in credential_files if probe_readable(p)]
            connectable = []
            for path in sockets:
                sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                try:
                    sock.settimeout(3)
                    sock.connect(path)
                    connectable.append(path)
                except OSError:
                    pass
                finally:
                    sock.close()
            result["sockets"] = connectable
            # Informational control: what an unconfined unprivileged process
            # may do with user namespaces on this image.
            libc = ctypes.CDLL(None, use_errno=True)
            control = {}
            for name, flag in (("unshare_user", CLONE_NEWUSER), ("unshare_net", CLONE_NEWNET)):
                rc = libc.unshare(flag)
                control[name] = "ok" if rc == 0 else errno.errorcode.get(
                    ctypes.get_errno(), str(ctypes.get_errno()))
            try:
                with open("/proc/self/attr/current") as fh:
                    control["label_after"] = fh.read(256).strip()
            except OSError:
                control["label_after"] = None
            result["userns_control"] = control
            return result

        result = as_untrusted(self.uid, self.gid, probes, timeout=120)
        problems = []
        if result["resuid"] != [self.uid] * 3 or result["resgid"] != [self.gid] * 3 \
                or result["groups"] not in ([], [self.gid]):
            problems.append("identity not fully dropped")
        if result["sudo_exit"] == 0:
            problems.append("sudo is usable")
        if result["writable"]:
            problems.append("writable: " + ",".join(result["writable"][:3]))
        if result["readable_credentials"]:
            problems.append("agent credentials readable: "
                            + ",".join(result["readable_credentials"][:3]))
        if result["sockets"]:
            problems.append("socket reachable: " + ",".join(result["sockets"]))
        env_keys = sorted(self.child_env())
        if any(re.search(r"TOKEN|SECRET|PASSWORD|CREDENTIAL|_KEY", k) for k in env_keys):
            problems.append("credential-like variable in child environment")
        self.ev["isolation"] = {
            "protected_paths": scans, "trusted_executables": chains,
            "trusted_executable_sha256": self.pre_trusted,
            "probe_targets": len(probe_targets), "probes_as_s01u": result,
            "child_environment_keys": env_keys,
            "acl_note": "mode bits and real access probes; POSIX ACLs not enumerated"}
        if problems:
            raise Stop(code, "; ".join(problems))
        env_child = self.child_env()
        node = self.node_real
        self.ev["source"]["node_version"] = as_untrusted(
            self.uid, self.gid, lambda: subprocess.run(
                [node, "--version"], env=env_child, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=30,
                check=False).stdout.decode("utf-8", "replace").strip()[:40])

    # -- 9. untrusted execution under observation --------------------------

    def kill_cgroup(self, wait=15):
        try:
            with open(CGROUP_DIR + "/cgroup.kill", "w") as fh:
                fh.write("1")
        except OSError:
            pass
        deadline = time.monotonic() + wait
        while time.monotonic() < deadline:
            if not self.tracker.pids():
                return True
            time.sleep(0.05)
        return not self.tracker.pids()

    def run_untrusted(self, argv, phase, timeout):
        """Run one PR-controlled command as s01u inside the tracking cgroup."""
        out_r, out_w = os.pipe()
        go_r, go_w = os.pipe()
        env = self.child_env()
        uid, gid = self.uid, self.gid
        pid = os.fork()
        if pid == 0:
            try:
                os.setsid()
                os.close(go_w)
                devnull = os.open("/dev/null", os.O_RDONLY)
                os.dup2(devnull, 0)
                os.dup2(out_w, 1)
                os.dup2(out_w, 2)
                os.chdir(WORK_DIR)
                os.umask(0o022)
                drop_privileges(uid, gid)
                # Wait until the observer has placed this process in the
                # tracking cgroup; only then is PR-controlled code executed.
                released = os.read(go_r, 1)
                os.closerange(3, 4096)
                if released != b"1":
                    os._exit(98)
                os.execve(argv[0], argv, env)
            except BaseException:  # noqa: BLE001
                pass
            os._exit(99)
        os.close(out_w)
        os.close(go_r)
        os.set_blocking(out_r, False)
        with open(CGROUP_DIR + "/cgroup.procs", "w") as fh:
            fh.write(str(pid))
        if pid not in self.tracker.pids():
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            raise Stop("PRIVILEGE_ISOLATION_FAILED", "child not placed in tracking cgroup")
        # The exact process the observer started: the root of this phase's
        # lineage (PID + start time, read before any PR code runs).
        root_key = self.tracker.identify(pid)
        if root_key is None:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            raise Stop("PRIVILEGE_ISOLATION_FAILED", "cannot identify the launched process")
        self.tracker.root_keys[phase] = root_key
        os.write(go_w, b"1")
        os.close(go_w)

        started = time.monotonic()
        exit_code, timed_out = None, False
        self.output += ("\n===== %s: %s =====\n" % (phase, " ".join(argv[1:]))).encode()
        while True:
            self.tracker.tick(phase)
            try:
                while True:
                    chunk = os.read(out_r, 65536)
                    if not chunk:
                        break
                    room = MAX_OUTPUT_BYTES * 2 - len(self.output)
                    self.output += chunk[:max(room, 0)]
                    self.output_dropped += max(len(chunk) - max(room, 0), 0)
            except BlockingIOError:
                pass
            done, status = os.waitpid(pid, os.WNOHANG)
            if done:
                exit_code = os.waitstatus_to_exitcode(status)
                break
            if time.monotonic() - started > timeout:
                timed_out = True
                self.kill_cgroup()
                _, status = os.waitpid(pid, 0)
                exit_code = os.waitstatus_to_exitcode(status)
                break
            time.sleep(SAMPLE_INTERVAL)
        self.tracker.tick(phase)
        os.close(out_r)
        leftovers = len(self.tracker.pids())
        emptied = self.kill_cgroup()
        result = {"argv": [os.path.basename(argv[0])] + argv[1:], "exit_code": exit_code,
                  "timed_out": timed_out, "seconds": round(time.monotonic() - started, 2),
                  "processes_left_after_exit": leftovers, "cgroup_emptied": emptied}
        if not emptied:
            raise Stop("TEARDOWN_INCOMPLETE", "tracking cgroup not empty after " + phase)
        return result

    def freeze_cgroup(self):
        """Freeze the tracking cgroup for one consistent sample. Best effort:
        an unconfirmed freeze is counted, and sampling then stays strict."""
        try:
            with open(CGROUP_DIR + "/cgroup.freeze", "w") as fh:
                fh.write("1")
            deadline = time.monotonic() + FREEZE_WAIT_SECONDS
            while time.monotonic() < deadline:
                if "frozen 1" in read_text(CGROUP_DIR + "/cgroup.events", 4096):
                    return True
                time.sleep(0.0005)
        except OSError:
            pass
        return False

    def thaw_cgroup(self):
        try:
            with open(CGROUP_DIR + "/cgroup.freeze", "w") as fh:
                fh.write("0")
        except OSError:
            pass

    def execute(self):
        node_stat = os.stat(self.node_real)
        self.tracker = Tracker(CGROUP_DIR,
                               [self.pre_chrome["chrome"]["dev"], self.pre_chrome["chrome"]["ino"]],
                               self.uid, self.chrome_files,
                               node_id=[node_stat.st_dev, node_stat.st_ino],
                               freeze=self.freeze_cgroup, thaw=self.thaw_cgroup)
        npm = os.path.join(self.a.node_bin_dir, "npm")
        runs = {}
        self.ev["execution"] = runs
        runs["npm_ci"] = self.run_untrusted([npm, "ci"], "npm_ci", NPM_CI_TIMEOUT)
        if runs["npm_ci"]["exit_code"] != 0:
            raise Stop("SMOKE_FAILED_WITHOUT_PROVEN_VIOLATION", "npm ci did not succeed")
        runs["smoke"] = self.run_untrusted([npm, "run", SMOKE_SCRIPT], "smoke", SMOKE_TIMEOUT)

    # -- 10. teardown, interpretation, sealing -----------------------------

    def teardown(self):
        """Every cleanup step runs; every failure is TEARDOWN_INCOMPLETE."""
        info, problems = {}, []

        def step(name, fn):
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - keep cleaning up
                problems.append("%s: %s: %s" % (name, type(exc).__name__, exc))

        def stop_processes():
            if self.cgroup_created:
                if self.tracker is None:
                    self.tracker = Tracker(CGROUP_DIR, [0, 0], self.uid)
                info["cgroup_emptied"] = self.kill_cgroup()
                if not info["cgroup_emptied"]:
                    problems.append("tracking cgroup still has processes")
            strays = []
            if self.uid is not None:
                for name in os.listdir("/proc"):
                    if not name.isdigit():
                        continue
                    try:
                        uids = parse_status(read_text("/proc/%s/status" % name, 16384))["uid"]
                        if self.uid in uids:
                            strays.append(int(name))
                            os.kill(int(name), signal.SIGKILL)
                    except (OSError, ValueError):
                        continue
            info["stray_s01u_processes"] = strays
            if strays:
                problems.append("s01u processes outside the tracking cgroup: %s" % strays[:5])

        def verify_files():
            if self.pre_chrome is not None:
                post, _ = self.chrome_snapshot()
                info["chrome_unchanged"] = post == self.pre_chrome
                self.ev["chrome_integrity"]["after"] = post
                if post != self.pre_chrome:
                    self.add_stop("CHROME_INTEGRITY_BOUNDARY_UNSATISFIED",
                                  "Chrome files changed during the qualification window")
            if self.pre_trusted:
                post = {p: sha256_file(p) for p in self.pre_trusted}
                info["trusted_executables_unchanged"] = post == self.pre_trusted
                if post != self.pre_trusted:
                    self.add_stop("FILESYSTEM_PROTECTION_UNSATISFIED",
                                  "Node/npm changed during the qualification window")

        def unmount():
            results = {}
            for tree, before in reversed(self.mounted):
                rc = run([tool("umount"), tree]).returncode
                remaining = len(mount_entries(tree))
                results[tree] = {"umount_exit": rc, "mounts_before": before,
                                 "mounts_after": remaining}
                if rc != 0 or remaining != before:
                    problems.append("read-only mount not removed: %s (exit %s, %d mounts, "
                                    "expected %d)" % (tree, rc, remaining, before))
            info["unmount"] = results

        def remove_cgroup():
            if self.cgroup_created:
                os.rmdir(CGROUP_DIR)
                if os.path.exists(CGROUP_DIR):
                    raise OSError("tracking cgroup still exists")
                info["cgroup_removed"] = True

        step("stop_processes", stop_processes)
        step("verify_files", verify_files)
        step("unmount", unmount)
        step("remove_cgroup", remove_cgroup)
        info["problems"] = problems
        info["complete"] = not problems
        for problem in problems:
            self.add_stop("TEARDOWN_INCOMPLETE", problem)
        self.ev["teardown"] = info

    def read_report(self):
        path = os.path.join(WORK_DIR, "reports/playwright/report.json")

        def reader():
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as fh:
                if not stat.S_ISREG(os.fstat(fh.fileno()).st_mode):
                    return None
                return fh.read(MAX_REPORT_BYTES + 1).decode("utf-8", "replace")

        try:
            text = as_untrusted(self.uid, self.gid, reader, cap=8 * 1024 * 1024)
        except Stop:
            return None, {"present": False}
        if text is None:
            return None, {"present": False}
        raw = text.encode("utf-8", "replace")
        info = {"present": True, "truncated": len(raw) > MAX_REPORT_BYTES,
                "sha256_of_captured": sha256_bytes(raw[:MAX_REPORT_BYTES]),
                "trust": "UNTRUSTED - written by PR-controlled code"}
        try:
            stats = json.loads(text).get("stats", {})
            info["stats"] = {k: stats.get(k) for k in ("expected", "unexpected", "skipped", "flaky")
                             if isinstance(stats.get(k), (int, float))}
        except (ValueError, AttributeError, RecursionError):
            info["stats"] = None
        return raw[:MAX_REPORT_BYTES], info

    def interpret(self):
        runs = self.ev.get("execution", {})
        smoke = runs.get("smoke")
        if smoke is None or self.tracker is None:
            return
        result = evaluate(self.tracker.table, {
            "node_id": self.tracker.node_id,
            "smoke_root": self.tracker.root_keys.get("smoke"),
            "work_dir": WORK_DIR,
            "unsampled": self.tracker.unsampled,
            "table_overflow": self.tracker.table_overflow,
            "init_ns": self.init_ns,
            "chrome_id": self.tracker.chrome_id,
            "helper_id": ([self.pre_chrome["helper"]["dev"], self.pre_chrome["helper"]["ino"]]
                          if self.pre_chrome["helper"] else None),
            "helper_setuid_capable": self.helper_setuid_capable,
            "untrusted_uid": self.uid,
            "grace": RENDERER_GRACE_SECONDS,
        })
        self.fails += result["fail"]
        self.stops += result["stop"]
        self.ev["assessment"] = result["summary"]
        self.ev["observation"] = {
            "sample_interval_seconds": SAMPLE_INTERVAL, "ticks": self.tracker.ticks,
            "renderer_grace_seconds": RENDERER_GRACE_SECONDS,
            "process_count": len(self.tracker.table),
            "ticks_without_confirmed_freeze": self.tracker.ticks_unfrozen,
            "unsampled_count": self.tracker.unsampled_count,
            "unsampled": self.tracker.unsampled,
            "phase_root_processes": self.tracker.root_keys,
            "instrumentation": "the tracking cgroup is frozen for each sample (timing only)",
            "limitation": "polling; a process that starts and is reaped between two "
                          "samples is not observed",
        }
        if smoke["timed_out"] or smoke["exit_code"] != 0:
            self.add_stop("SMOKE_FAILED_WITHOUT_PROVEN_VIOLATION",
                          "smoke exit=%s timed_out=%s" % (smoke["exit_code"], smoke["timed_out"]))

    def seal(self):
        a = self.a
        files = {}
        report, report_info = (None, {"present": False})
        if self.uid is not None and os.path.isdir(WORK_DIR):
            report, report_info = self.read_report()
        self.ev["untrusted_report"] = report_info
        if report is not None:
            files["untrusted-report.json"] = report
        head = bytes(self.output[:MAX_OUTPUT_BYTES])
        files["untrusted-output.txt"] = (
            b"UNTRUSTED OUTPUT of PR-controlled commands (truncated to %d bytes, "
            b"%d bytes dropped)\n" % (MAX_OUTPUT_BYTES,
                                      self.output_dropped + max(len(self.output) - MAX_OUTPUT_BYTES, 0))
            + head)

        self.ev["finished_utc"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        processes = self.tracker.export() if self.tracker is not None else {}

        def render(table):
            body = dict(self.ev, processes=table,
                        verdict=decide(self.fails, self.stops),
                        fail_reasons=self.fails, stop_reasons=self.stops)
            return json.dumps(body, indent=1, sort_keys=True).encode()

        for path, mode in ((EVIDENCE_DIR, 0o700), (a.publish_dir, 0o755)):
            ensure_root_dir(path, mode)
        evidence = render(processes)
        fixed = sum(len(v) for v in files.values())
        if len(evidence) + fixed > MAX_EVIDENCE_BYTES:
            self.add_stop("INCOMPLETE_EVIDENCE", "evidence exceeds the size bound")
            evidence = render({"omitted": "process table exceeded the evidence size bound"})
        files["evidence.json"] = evidence
        verdict = decide(self.fails, self.stops)
        files["verdict.json"] = json.dumps({
            "verdict": verdict, "fail_reasons": self.fails, "stop_reasons": self.stops,
            "scope": SCOPE_STATEMENT, "identity": self.ev["identity"],
            "observer_sha256": self.ev.get("observer", {}).get("sha256"),
            "teardown": self.ev.get("teardown"),
            "security_certified": False,
        }, indent=1, sort_keys=True).encode()

        manifest = "".join("%s  %s\n" % (sha256_bytes(data), name)
                           for name, data in sorted(files.items())).encode()
        files["MANIFEST.sha256"] = manifest
        for name, data in files.items():
            fd = os.open(os.path.join(EVIDENCE_DIR, name),
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)

        # Transfer to the runner-readable publish directory. All s01u
        # processes are gone (teardown) and s01u never had write access to
        # this location (isolation preflight), so the copy stays intact.
        for name, data in files.items():
            fd = os.open(os.path.join(a.publish_dir, name),
                         os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
        for name, data in files.items():
            if sha256_file(os.path.join(a.publish_dir, name)) != sha256_bytes(data):
                for published in files:
                    try:
                        os.unlink(os.path.join(a.publish_dir, published))
                    except OSError:
                        pass
                raise Stop("INCOMPLETE_EVIDENCE", "published evidence differs from sealed copy")
        return verdict, sha256_bytes(manifest)

    # -- driver ------------------------------------------------------------

    def main(self):
        # Order matters: protection and source preparation come first, and
        # the isolation preflight is the last step before PR code runs, so it
        # checks the final state of every protected object.
        steps = (("startup", self.startup), ("host", self.host),
                 ("account", self.account), ("cgroup", self.cgroup),
                 ("protect", self.protect),
                 ("chrome_integrity", self.chrome_integrity),
                 ("source", self.source), ("isolation", self.isolation),
                 ("execute", self.execute))
        try:
            for name, fn in steps:
                self.phase(name, fn)
        except Stop as exc:
            self.add_stop(exc.code, exc.detail)
        except Exception as exc:  # noqa: BLE001 - any surprise is a STOP
            self.add_stop("OBSERVER_INTERNAL_ERROR", "%s: %s" % (type(exc).__name__, exc))
        try:
            self.teardown()
            self.interpret()
        except Exception as exc:  # noqa: BLE001
            self.add_stop("OBSERVER_INTERNAL_ERROR",
                          "teardown/interpretation: %s: %s" % (type(exc).__name__, exc))
        try:
            verdict, manifest_digest = self.seal()
        except Exception as exc:  # noqa: BLE001
            print("S01_VERDICT=STOP")
            print(printable("S01_STOP=EVIDENCE_SEALING_FAILED %s: %s" % (type(exc).__name__, exc)))
            return 2
        for item in self.fails:
            print(printable("S01_FAIL=%s %s" % (item["code"], item["detail"])))
        for item in self.stops:
            print(printable("S01_STOP=%s %s" % (item["code"], item["detail"])))
        print("S01_MANIFEST_SHA256=" + manifest_digest)
        print("S01_VERDICT=" + verdict)
        return {"PASS": 0, "FAIL": 1}.get(verdict, 2)


def pattern(regex):
    compiled = re.compile(regex)

    def check(value):
        if not compiled.fullmatch(value):
            raise argparse.ArgumentTypeError("invalid value")
        return value
    return check


def abs_path(value):
    if not value.startswith("/") or "\x00" in value or os.path.normpath(value) != value:
        raise argparse.ArgumentTypeError("path must be absolute and normalized")
    return value


def parse_args(argv):
    sha = pattern(r"[0-9a-f]{40}")
    number = pattern(r"[1-9][0-9]{0,11}")
    text = pattern(r"[A-Za-z0-9._/ -]{1,100}")
    p = argparse.ArgumentParser(description="S-01 trusted actual-smoke qualification observer")
    p.add_argument("--repository", required=True, type=pattern(r"[A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}"))
    p.add_argument("--run-id", required=True, type=number)
    p.add_argument("--run-attempt", required=True, type=number)
    p.add_argument("--job", required=True, type=text)
    p.add_argument("--workflow-ref", required=True, type=text)
    p.add_argument("--workflow-sha", required=True, type=sha)
    p.add_argument("--pr-number", required=True, type=number)
    p.add_argument("--expected-head-sha", required=True, type=sha)
    p.add_argument("--expected-tree-sha", required=True, type=sha)
    p.add_argument("--trusted-checkout", required=True, type=abs_path)
    p.add_argument("--pr-checkout", required=True, type=abs_path)
    p.add_argument("--node-bin-dir", required=True, type=abs_path)
    p.add_argument("--publish-dir", required=True, type=abs_path)
    p.add_argument("--protected-path", action="append", default=[], type=abs_path)
    p.add_argument("--runner-path", required=True, type=pattern(r"[\x20-\x7e]{1,8000}"))
    p.add_argument("--image-os", default="", type=pattern(r"[A-Za-z0-9._-]{0,60}"))
    p.add_argument("--image-version", default="", type=pattern(r"[A-Za-z0-9._-]{0,60}"))
    return p.parse_args(argv)


if __name__ == "__main__":
    sys.exit(Qualification(parse_args(sys.argv[1:])).main())
