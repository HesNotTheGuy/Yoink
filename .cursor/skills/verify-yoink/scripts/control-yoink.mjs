#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SCRIPT_DIR, "..");
const CURRENT_POINTER = path.join(os.tmpdir(), "yoink-verify-current.json");
const NEXT_PORT = 3000;
const DEFAULT_CDP = 9222;

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function readPkgName(pkgPath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

function findRepoRoot() {
  const starts = [process.cwd(), path.resolve(SKILL_DIR, "..", "..", "..")];
  for (const start of starts) {
    let dir = start;
    for (;;) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath) && readPkgName(pkgPath) === "yoink") return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  die("Run this from the Yoink repo (package.json name must be yoink).");
}

function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(token);
    }
  }
  return { flags, positionals };
}

function repoRelative(repoRoot, maybePath) {
  if (!maybePath) return maybePath;
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(repoRoot, maybePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidAlive(pid) {
  if (!pid || !Number.isInteger(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === "ESRCH") return false;
    return true;
  }
}

function signalProcess(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
}

function killTree(pid) {
  if (!pidAlive(pid)) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" }).on("error", () => {});
    return;
  }
  try {
    process.kill(-pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
    signalProcess(pid, "SIGTERM");
  }
}

async function waitForDeath(pid, ms = 5000) {
  const start = Date.now();
  while (pidAlive(pid) && Date.now() - start < ms) await sleep(100);
  if (pidAlive(pid) && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
      signalProcess(pid, "SIGKILL");
    }
  }
}

function portOwnerGuess(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
  });
}

function waitForHttp(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });
      req.on("error", retry);
      req.setTimeout(2000, () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(attempt, 250);
    };
    attempt();
  });
}

function httpJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode >= 400) {
          reject(new Error(`${url} -> ${res.statusCode}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error(`timeout ${url}`));
    });
  });
}

async function freePort(preferred) {
  if (!(await portOwnerGuess(preferred))) return preferred;
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : preferred;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

function buildPaths(repoRoot, runId, cdpPort) {
  const homeDir = path.join(os.tmpdir(), `yoink-verify-${runId}`);
  const dataDir =
    process.platform === "win32"
      ? path.join(homeDir, "AppData", "Roaming", "Yoink")
      : path.join(homeDir, ".yoink");
  return {
    runId,
    repoRoot,
    homeDir,
    dataDir,
    outputDir: path.join(homeDir, "Downloads"),
    userDataDir: path.join(homeDir, "electron-user-data"),
    evidenceDir: path.join(SKILL_DIR, "evidence", runId),
    logsDir: path.join(homeDir, "logs"),
    cdpPort,
    nextPort: NEXT_PORT,
    nextPid: null,
    electronPid: null,
    startedAt: new Date().toISOString(),
  };
}

function readPointer() {
  try {
    return JSON.parse(fs.readFileSync(CURRENT_POINTER, "utf8"));
  } catch {
    return null;
  }
}

function readState() {
  const pointer = readPointer();
  if (!pointer?.statePath || !fs.existsSync(pointer.statePath)) return null;
  return JSON.parse(fs.readFileSync(pointer.statePath, "utf8"));
}

function writeState(state) {
  fs.mkdirSync(state.homeDir, { recursive: true });
  const statePath = path.join(state.homeDir, "state.json");
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  fs.writeFileSync(
    CURRENT_POINTER,
    JSON.stringify({ runId: state.runId, statePath }, null, 2)
  );
  return statePath;
}

function requireState() {
  const state = readState();
  if (!state) die("No verification run is active. Run launch first.");
  return state;
}

function isolatedEnv(state) {
  const originalHome = process.env.HOME || os.homedir();
  const inheritedXauth = process.env.XAUTHORITY || path.join(originalHome, ".Xauthority");
  const env = { ...process.env };
  env.HOME = state.homeDir;
  env.USERPROFILE = state.homeDir;
  env.XDG_CONFIG_HOME = path.join(state.homeDir, ".config");
  env.XDG_CACHE_HOME = path.join(state.homeDir, ".cache");
  env.XDG_DATA_HOME = path.join(state.homeDir, ".local", "share");
  env.NODE_ENV = "development";
  env.ELECTRON_ENABLE_LOGGING = "1";
  if (inheritedXauth && fs.existsSync(inheritedXauth)) {
    env.XAUTHORITY = inheritedXauth;
  }
  if (process.platform === "win32") {
    env.APPDATA = path.join(state.homeDir, "AppData", "Roaming");
  } else {
    delete env.APPDATA;
  }
  return env;
}

function spawnLogged(command, args, { env, cwd, logPath, extraEnv }) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, "a");
  const child = spawn(command, args, {
    cwd,
    env: extraEnv ?? env,
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  fs.closeSync(logFd);
  child.unref();
  return child;
}

function electronBin(repoRoot) {
  const bin = path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "electron.cmd" : "electron"
  );
  if (!fs.existsSync(bin)) {
    die("node_modules/.bin/electron is missing. Run npm install at the repo root.");
  }
  return bin;
}

function nextBin(repoRoot) {
  const bin = path.join(
    repoRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "next.cmd" : "next"
  );
  if (!fs.existsSync(bin)) {
    die("node_modules/.bin/next is missing. Run npm install at the repo root.");
  }
  return bin;
}

async function pageTarget(cdpPort) {
  const list = await httpJson(`http://127.0.0.1:${cdpPort}/json/list`);
  const pages = list.filter(
    (t) =>
      t.type === "page" &&
      typeof t.webSocketDebuggerUrl === "string" &&
      /localhost:3000|127\.0\.0\.1:3000/.test(t.url || "") &&
      !String(t.url).startsWith("devtools:")
  );
  if (pages.length === 0) {
    throw new Error("CDP has no Yoink renderer page on http://localhost:3000");
  }
  return pages[0];
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data));
      if (msg.id == null) return;
      const waiter = this.pending.get(msg.id);
      if (!waiter) return;
      this.pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else waiter.resolve(msg.result);
    });
  }

  static connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("CDP websocket timed out"));
      }, 10_000);
      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new Cdp(ws));
      });
      ws.addEventListener("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text ||
        "Runtime.evaluate failed";
      throw new Error(text);
    }
    return result.result?.value;
  }

  close() {
    this.ws.close();
  }
}

async function withPage(state, fn) {
  const target = await pageTarget(state.cdpPort);
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  try {
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    return await fn(cdp, target);
  } finally {
    cdp.close();
  }
}

function clickScript(text, exact) {
  const needle = JSON.stringify(text);
  const exactJs = exact ? "true" : "false";
  return `(() => {
    const needle = ${needle};
    const exact = ${exactJs};
    const nodes = [...document.querySelectorAll("button, a, [role='button']")];
    const matches = nodes.filter((el) => {
      const label = (el.getAttribute("aria-label") || el.textContent || "").replace(/\\s+/g, " ").trim();
      return exact ? label === needle : label.includes(needle);
    });
    if (matches.length === 0) throw new Error("No clickable control matching " + JSON.stringify(needle));
    if (matches.length > 1) {
      const labels = matches.map((el) => (el.textContent || "").replace(/\\s+/g, " ").trim());
      throw new Error("Ambiguous click for " + JSON.stringify(needle) + ": " + JSON.stringify(labels));
    }
    matches[0].click();
    return (matches[0].textContent || "").replace(/\\s+/g, " ").trim();
  })()`;
}

function fillScript({ placeholder, label, value }) {
  const placeholderJs = JSON.stringify(placeholder ?? "");
  const labelJs = JSON.stringify(label ?? "");
  const valueJs = JSON.stringify(value);
  return `(() => {
    const value = ${valueJs};
    const placeholder = ${placeholderJs};
    const labelText = ${labelJs};
    let el = null;
    if (labelText) {
      const labels = [...document.querySelectorAll("label")];
      const lab = labels.find((n) => (n.textContent || "").replace(/\\s+/g, " ").trim() === labelText);
      if (!lab) throw new Error("No label " + JSON.stringify(labelText));
      const root = lab.parentElement || document;
      el = root.querySelector("input, textarea, select");
    } else if (placeholder) {
      el = [...document.querySelectorAll("input, textarea")].find((n) =>
        (n.getAttribute("placeholder") || "").includes(placeholder)
      );
    }
    if (!el) throw new Error("No field to fill");
    el.focus();
    const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, "value");
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return el.value;
  })()`;
}

async function cmdLaunch(flags) {
  const repoRoot = findRepoRoot();
  const existing = readState();
  if (existing) {
    const health = await doctorPayload(existing);
    if (health.ok) {
      console.log(JSON.stringify(existing, null, 2));
      return;
    }
    await cmdCleanup({ "keep-scratch": true }, { silent: true });
  }

  if (await portOwnerGuess(NEXT_PORT)) {
    die(
      `Port ${NEXT_PORT} is already in use. Yoink's Electron shell always loads http://localhost:${NEXT_PORT} in dev (electron/main.ts DEV_URL). Stop the other process or reuse it only if this helper launched it.`
    );
  }

  const runId = String(flags["run-id"] || process.env.YOINK_VERIFY_RUN_ID || `run-${Date.now()}`);
  const cdpPort = Number(flags["cdp-port"] || (await freePort(DEFAULT_CDP)));
  const state = buildPaths(repoRoot, runId, cdpPort);
  fs.mkdirSync(state.outputDir, { recursive: true });
  fs.mkdirSync(state.dataDir, { recursive: true });
  fs.mkdirSync(state.userDataDir, { recursive: true });
  fs.mkdirSync(state.evidenceDir, { recursive: true });
  fs.mkdirSync(state.logsDir, { recursive: true });

  const env = isolatedEnv(state);
  const nextLog = path.join(state.logsDir, "next.log");
  const electronLog = path.join(state.logsDir, "electron.log");

  const nextChild = spawnLogged(nextBin(repoRoot), ["dev", "--hostname", "127.0.0.1", "--port", String(NEXT_PORT)], {
    cwd: repoRoot,
    env,
    logPath: nextLog,
  });
  state.nextPid = nextChild.pid;
  writeState(state);

  try {
    await waitForHttp(`http://127.0.0.1:${NEXT_PORT}`, 60_000);
  } catch (err) {
    killTree(state.nextPid);
    die(`${err.message}. See ${nextLog}`);
  }

  const built = spawn(process.execPath, [path.join(repoRoot, "electron", "build.mjs")], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  const buildCode = await new Promise((resolve) => built.on("exit", resolve));
  if (buildCode !== 0) {
    killTree(state.nextPid);
    die(`electron/build.mjs failed with exit ${buildCode}`);
  }

  const electronArgs = [
    `--remote-debugging-port=${state.cdpPort}`,
    `--user-data-dir=${state.userDataDir}`,
    path.join(repoRoot, "dist-electron", "main.js"),
  ];
  if (process.platform === "linux") {
    electronArgs.unshift("--no-sandbox", "--disable-gpu");
  }

  let electronCmd = electronBin(repoRoot);
  let electronArgv = electronArgs;
  const xvfb = "/usr/bin/xvfb-run";
  if (process.platform === "linux") {
    if (fs.existsSync(xvfb)) {
      electronCmd = xvfb;
      electronArgv = ["-a", electronBin(repoRoot), ...electronArgs];
    } else if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
      await cmdCleanup({ "keep-scratch": true }, { silent: true });
      die("No DISPLAY and xvfb-run is missing. Provide a display or install xvfb.");
    }
  }

  const electronChild = spawnLogged(electronCmd, electronArgv, {
    cwd: repoRoot,
    env,
    logPath: electronLog,
  });
  state.electronPid = electronChild.pid;
  writeState(state);

  const readyDeadline = Date.now() + 60_000;
  let lastErr = "Electron did not publish a CDP page";
  while (Date.now() < readyDeadline) {
    try {
      await withPage(state, async (cdp) => {
        const title = await cdp.evaluate(
          `document.querySelector("h1") && document.querySelector("h1").textContent`
        );
        if (title !== "Yoink") throw new Error(`Unexpected h1 ${JSON.stringify(title)}`);
      });
      lastErr = "";
      break;
    } catch (err) {
      lastErr = err.message;
      if (!pidAlive(state.electronPid)) {
        await cmdCleanup({ "keep-scratch": true }, { silent: true });
        die(`Electron exited during launch. ${lastErr}. See ${electronLog}`);
      }
      await sleep(300);
    }
  }
  if (lastErr) {
    await cmdCleanup({ "keep-scratch": true }, { silent: true });
    die(`${lastErr}. See ${electronLog}`);
  }

  writeState(state);
  console.log(JSON.stringify(state, null, 2));
}

async function doctorPayload(state) {
  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
  };

  add("state-file", true, path.join(state.homeDir, "state.json"));
  add("next-pid-alive", pidAlive(state.nextPid), String(state.nextPid));
  add("electron-pid-alive", pidAlive(state.electronPid), String(state.electronPid));
  add("home-is-tmp", state.homeDir.startsWith(os.tmpdir() + path.sep), state.homeDir);
  add(
    "data-dir-isolated",
    state.dataDir.startsWith(state.homeDir + path.sep),
    state.dataDir
  );
  add("evidence-dir", fs.existsSync(state.evidenceDir), state.evidenceDir);

  let httpOk = false;
  let httpDetail = "";
  try {
    await waitForHttp(`http://127.0.0.1:${state.nextPort}`, 3000);
    httpOk = true;
    httpDetail = `http://127.0.0.1:${state.nextPort}`;
  } catch (err) {
    httpDetail = err.message;
  }
  add("next-http", httpOk, httpDetail);

  let cdpOk = false;
  let cdpDetail = "";
  try {
    const target = await pageTarget(state.cdpPort);
    cdpOk = true;
    cdpDetail = target.url;
  } catch (err) {
    cdpDetail = err.message;
  }
  add("cdp-renderer", cdpOk, cdpDetail);

  let headingOk = false;
  let headingDetail = "";
  if (cdpOk) {
    try {
      headingDetail = await withPage(state, (cdp) =>
        cdp.evaluate(`document.querySelector("h1") && document.querySelector("h1").textContent`)
      );
      headingOk = headingDetail === "Yoink";
    } catch (err) {
      headingDetail = err.message;
    }
  }
  add("heading-yoink", headingOk, headingDetail);

  if (process.platform !== "win32" && process.env.APPDATA) {
    add(
      "appdata-unset-on-posix",
      false,
      "APPDATA is set on a non-Windows host. lib/ytdlp.ts would look under APPDATA/Yoink while settings stay in ~/.yoink."
    );
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks, state };
}

async function cmdDoctor(flags) {
  const state = requireState();
  const payload = await doctorPayload(state);
  const text = JSON.stringify(payload, null, 2);
  if (flags.path) {
    const out = repoRelative(state.repoRoot, flags.path);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
  }
  console.log(text);
  if (!payload.ok) process.exit(1);
}

async function cmdClick(flags) {
  const state = requireState();
  const text = flags.text;
  if (!text) die("click requires --text");
  const clicked = await withPage(state, (cdp) => cdp.evaluate(clickScript(text, Boolean(flags.exact))));
  console.log(JSON.stringify({ clicked }));
}

async function cmdFill(flags) {
  const state = requireState();
  if (flags.value == null) die("fill requires --value");
  if (!flags.placeholder && !flags.label) die("fill requires --placeholder or --label");
  const written = await withPage(state, (cdp) =>
    cdp.evaluate(
      fillScript({
        placeholder: flags.placeholder || "",
        label: flags.label || "",
        value: String(flags.value),
      })
    )
  );
  console.log(JSON.stringify({ value: written }));
}

async function cmdEval(flags) {
  const state = requireState();
  const expression = flags.js;
  if (!expression) die("eval requires --js");
  const value = await withPage(state, (cdp) => cdp.evaluate(expression));
  console.log(JSON.stringify({ value }, null, 2));
}

async function cmdWait(flags) {
  const state = requireState();
  const text = flags.text;
  if (!text) die("wait requires --text");
  const timeout = Number(flags.timeout || 10_000);
  const start = Date.now();
  const needle = JSON.stringify(text);
  while (Date.now() - start < timeout) {
    const found = await withPage(state, (cdp) =>
      cdp.evaluate(
        `(() => {
          const needle = ${needle}.toLowerCase();
          const hay = (document.body && document.body.innerText) || "";
          return hay.toLowerCase().includes(needle);
        })()`
      )
    );
    if (found) {
      console.log(JSON.stringify({ found: true, text }));
      return;
    }
    await sleep(200);
  }
  die(`Timed out waiting for text ${JSON.stringify(text)}`);
}

async function cmdScreenshot(flags) {
  const state = requireState();
  if (!flags.path) die("screenshot requires --path");
  const out = repoRelative(state.repoRoot, flags.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const data = await withPage(state, (cdp) =>
    cdp.send("Page.captureScreenshot", { format: "png" })
  );
  fs.writeFileSync(out, Buffer.from(data.data, "base64"));
  console.log(JSON.stringify({ path: out }));
}

async function cmdSnapshot(flags) {
  const state = requireState();
  if (!flags.path) die("snapshot requires --path");
  const out = repoRelative(state.repoRoot, flags.path);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tree = await withPage(state, async (cdp) => {
    try {
      await cdp.send("Accessibility.enable");
      return await cdp.send("Accessibility.getFullAXTree");
    } catch {
      const html = await cdp.evaluate(`document.documentElement.outerHTML`);
      return { fallback: "html", html };
    }
  });
  fs.writeFileSync(out, JSON.stringify(tree, null, 2));
  console.log(JSON.stringify({ path: out }));
}

function printJsonFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log("null");
    return;
  }
  console.log(fs.readFileSync(filePath, "utf8"));
}

async function cmdSettingsFile() {
  const state = requireState();
  printJsonFile(path.join(state.dataDir, "settings.json"));
}

async function cmdHistoryFile() {
  const state = requireState();
  printJsonFile(path.join(state.dataDir, "history.json"));
}

async function cmdCleanup(flags, opts = {}) {
  const state = readState();
  if (!state) {
    if (!opts.silent) console.log(JSON.stringify({ cleaned: false, reason: "no active run" }));
    return;
  }
  killTree(state.electronPid);
  killTree(state.nextPid);
  await waitForDeath(state.electronPid);
  await waitForDeath(state.nextPid);
  if (fs.existsSync(CURRENT_POINTER)) fs.rmSync(CURRENT_POINTER, { force: true });
  const keepScratch = Boolean(flags["keep-scratch"]);
  if (!keepScratch && state.homeDir.startsWith(os.tmpdir() + path.sep)) {
    fs.rmSync(state.homeDir, { recursive: true, force: true });
  }
  if (!opts.silent) {
    console.log(
      JSON.stringify(
        {
          cleaned: true,
          evidenceDir: state.evidenceDir,
          evidenceExists: fs.existsSync(state.evidenceDir),
          scratchRemoved: !keepScratch,
        },
        null,
        2
      )
    );
  }
}

const USAGE = `Usage: node .cursor/skills/verify-yoink/scripts/control-yoink.mjs <command> [flags]

Commands:
  launch [--run-id ID] [--cdp-port N]
  doctor [--path FILE]
  click --text TEXT [--exact]
  fill --value VALUE (--placeholder TEXT | --label TEXT)
  eval --js EXPRESSION
  wait --text TEXT [--timeout MS]
  screenshot --path FILE
  snapshot --path FILE
  settings-file
  history-file
  cleanup [--keep-scratch]
`;

const { flags, positionals } = parseArgs(process.argv.slice(2));
const command = positionals[0];

try {
  if (command === "launch") await cmdLaunch(flags);
  else if (command === "doctor") await cmdDoctor(flags);
  else if (command === "click") await cmdClick(flags);
  else if (command === "fill") await cmdFill(flags);
  else if (command === "eval") await cmdEval(flags);
  else if (command === "wait") await cmdWait(flags);
  else if (command === "screenshot") await cmdScreenshot(flags);
  else if (command === "snapshot") await cmdSnapshot(flags);
  else if (command === "settings-file") await cmdSettingsFile();
  else if (command === "history-file") await cmdHistoryFile();
  else if (command === "cleanup") await cmdCleanup(flags);
  else die(USAGE);
} catch (err) {
  die(err.stack || err.message);
}
