import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import crypto from "node:crypto";
import { test } from "node:test";
import ts from "typescript";
const source = fs.readFileSync(
  new URL("../src/si-chat.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
function fixture(call, after = async () => {}, before = async () => {}) {
  const nodes = new Map();
  const element = () => ({
    hidden: false,
    disabled: false,
    checked: false,
    value: "",
    textContent: "",
    listeners: new Map(),
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    replaceChildren() {},
    focus() {},
    setAttribute() {},
  });
  const host = {
    ...element(),
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
  };
  const context = {
    exports: {},
    require: () => ({ call }),
    setInterval: () => 0,
    clearInterval() {},
    setTimeout,
    clearTimeout,
    crypto,
    document: { querySelector: () => null },
  };
  vm.runInNewContext(code, context);
  const chat = new context.exports.SIChat(host, {
    configure: async () => {},
    before,
    after,
    error: (error) => {
      throw error;
    },
  });
  chat.initialized = true;
  chat.sessionReady = true;
  chat.connected = true;
  chat.session = "session";
  chat.revision = 1;
  return { chat, nodes, host };
}
const state = (session_id = "session", draft = "hello") => ({
  session_id,
  revision: 1,
  messages: [],
  draft,
  active: null,
});
for (const stage of ["after", "connection"]) {
  test(`an old ${stage} completion cannot publish Ready over a new request`, async () => {
    const entered = deferred(),
      release = deferred();
    let queued = false;
    const { chat, nodes } = fixture(
      async (command) => {
        if (command === "si_chat_state") return state();
        if (command === "si_status") {
          if (stage === "connection") {
            entered.resolve();
            await release.promise;
          }
          return { connected: true, root: "old-root", running: queued };
        }
        if (command === "si_chat_send") {
          queued = true;
          return { job_id: "next" };
        }
        throw Error(command);
      },
      async () => {
        if (stage === "after") {
          entered.resolve();
          await release.promise;
        }
      },
    );
    try {
      chat.busy = stage === "after";
      nodes.get("#si-prompt").value = "hello";
      const polling = chat.sync();
      await entered.promise;
      await chat.send();
      chat.root = "current-root";
      assert.equal(queued, true);
      assert.equal(nodes.get("#si-progress").textContent, "Starting…");
      release.resolve();
      await polling;
      assert.equal(nodes.get("#si-progress").textContent, "Starting…");
      assert.equal(chat.root, "current-root");
      assert.equal(chat.busy, true);
      assert.equal(chat.entries.size, 0);
    } finally {
      release.resolve();
      chat.dispose();
    }
  });
}
for (const lifecycle of ["hide", "dispose"]) {
  test(`pending connection status cannot publish after ${lifecycle}`, async () => {
    const entered = deferred(),
      release = deferred();
    const { chat, nodes } = fixture(async (command) => {
      if (command === "si_chat_state") return state();
      if (command === "si_status") {
        entered.resolve();
        await release.promise;
        return { connected: false, root: "obsolete", running: false };
      }
      throw Error(command);
    });
    try {
      const polling = chat.sync();
      await entered.promise;
      chat[lifecycle]();
      nodes.get("#si-progress").textContent = "closed";
      chat.root = "retained";
      release.resolve();
      await polling;
      assert.equal(nodes.get("#si-progress").textContent, "closed");
      assert.equal(chat.root, "retained");
    } finally {
      release.resolve();
      chat.dispose();
    }
  });
}
for (const initialSession of [null, "previous-session"]) {
  test(`open waits for current session after replacing ${initialSession ?? "disconnected state"}`, async () => {
    const entered = deferred(),
      release = deferred();
    let backendSession = initialSession,
      statusCalls = 0,
      stateCalls = 0,
      sends = 0;
    const drafts = [];
    const { chat, nodes } = fixture(async (command, args) => {
      if (command === "si_chat_state") {
        stateCalls++;
        return state(backendSession, "");
      }
      if (command === "si_status") {
        if (++statusCalls === 1) {
          entered.resolve();
          await release.promise;
        }
        return {
          connected: backendSession !== null,
          root: null,
          running: false,
        };
      }
      if (command === "si_chat_draft") {
        drafts.push(args);
        if (args.session_id !== backendSession)
          throw Error(
            "CONFLICT: conversation changed; old draft was not saved into the new session",
          );
        return { saved: true };
      }
      if (command === "si_chat_send") {
        sends++;
        return { job_id: "first" };
      }
      throw Error(command);
    });
    try {
      chat.session = initialSession;
      chat.connected = initialSession !== null;
      const polling = chat.sync();
      await entered.promise;
      backendSession = "replacement-session";
      const opening = chat.open(false);
      assert.equal(nodes.get("#si-send").disabled, true);
      assert.equal(nodes.get("#si-prompt").disabled, true);
      release.resolve();
      await Promise.all([polling, opening]);
      assert.equal(stateCalls, 2);
      assert.equal(chat.session, backendSession);
      assert.equal(nodes.get("#si-send").disabled, false);
      assert.equal(nodes.get("#si-prompt").disabled, false);
      nodes.get("#si-prompt").value = "first connected message";
      chat.draftDirty = true;
      await chat.send();
      assert.equal(drafts.length, 1);
      assert.equal(drafts[0].session_id, backendSession);
      assert.equal(drafts[0].text, "first connected message");
      assert.equal(sends, 1);
    } finally {
      release.resolve();
      chat.dispose();
    }
  });
}
test("a connection change between state and status cannot enable an unsynchronized draft", async () => {
  const entered = deferred(),
    release = deferred();
  let session = null,
    statusCalls = 0;
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_state") return state(session, "");
    if (command === "si_status") {
      if (++statusCalls === 1) {
        entered.resolve();
        await release.promise;
      }
      return { connected: session !== null, root: null, running: false };
    }
    throw Error(command);
  });
  try {
    chat.session = null;
    chat.connected = false;
    const polling = chat.sync();
    await entered.promise;
    session = "new-session";
    release.resolve();
    await polling;
    assert.equal(nodes.get("#si-send").disabled, true);
    assert.notEqual(nodes.get("#si-progress").textContent, "Ready");
    await chat.sync();
    assert.equal(chat.session, session);
    assert.equal(nodes.get("#si-send").disabled, false);
    assert.equal(nodes.get("#si-progress").textContent, "Ready");
  } finally {
    release.resolve();
    chat.dispose();
  }
});
test("reopening the same session preserves an unsent local draft", async () => {
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_state")
      return state("session", "older backend draft");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "unsent local draft";
    chat.draftDirty = true;
    await chat.open(false);
    assert.equal(nodes.get("#si-prompt").value, "unsent local draft");
    assert.equal(chat.draftDirty, true);
    assert.equal(nodes.get("#si-send").disabled, false);
  } finally {
    chat.dispose();
  }
});

test("a saved draft cannot cross services and remains local until explicitly cleared", async () => {
  const entered = deferred(),
    release = deferred();
  let session = "old-session",
    statusCalls = 0,
    attempts = 0,
    draftWrites = 0;
  const accepted = [];
  const oldDraft = "  Draft for the old service  ";
  const { chat, nodes } = fixture(async (command, args) => {
    if (command === "si_chat_state")
      return state(
        session,
        session === "old-session"
          ? oldDraft
          : session === "replacement-session"
            ? "Replacement draft"
            : "",
      );
    if (command === "si_status") {
      if (++statusCalls === 1) {
        entered.resolve();
        await release.promise;
      }
      return { connected: true, root: null, running: false };
    }
    if (command === "si_chat_send") {
      attempts++;
      assert.equal(
        args.expected_session,
        session === "replacement-session" ? "old-session" : session,
      );
      if (args.expected_session !== session)
        throw Error("CONFLICT: conversation changed; message was not sent");
      accepted.push(args.prompt);
      return { job_id: "safe" };
    }
    if (command === "si_chat_draft") {
      draftWrites++;
      assert.equal(args.session_id, session);
      return { saved: true };
    }
    if (command === "si_clear") {
      session = "explicit-new-chat";
      return {};
    }
    throw Error(command);
  });
  try {
    chat.session = "old-session";
    const polling = chat.sync();
    await entered.promise;
    session = "replacement-session";
    release.resolve();
    await polling;
    assert.equal(chat.draftDirty, false);
    assert.equal(nodes.get("#si-prompt").value, oldDraft);
    await assert.rejects(chat.send(), /CONFLICT: conversation changed/);
    assert.equal(chat.heldDraft.session, "old-session");
    assert.equal(accepted.length, 0);
    assert.equal(attempts, 1);
    assert.equal(draftWrites, 0);
    await chat.sync();
    await chat.flushDraft();
    await chat.send();
    await chat.open(false);
    assert.equal(accepted.length, 0);
    assert.equal(attempts, 1);
    assert.equal(draftWrites, 0);
    assert.equal(nodes.get("#si-prompt").value, oldDraft);
    assert.equal(nodes.get("#si-prompt").readOnly, true);
    assert.equal(nodes.get("#si-prompt").disabled, false);
    assert.equal(nodes.get("#si-send").disabled, true);
    assert.match(nodes.get("#si-progress").textContent, /not sent/);
    await nodes.get("#si-new").listeners.get("click")();
    assert.equal(chat.heldDraft, null);
    assert.equal(nodes.get("#si-prompt").value, "");
    assert.equal(nodes.get("#si-prompt").readOnly, false);
    assert.equal(nodes.get("#si-send").disabled, false);
    nodes.get("#si-prompt").value = "Explicit new message";
    chat.draftDirty = true;
    await chat.send();
    assert.deepEqual(accepted, ["Explicit new message"]);
    assert.equal(draftWrites, 1);
  } finally {
    release.resolve();
    chat.dispose();
  }
});

test("send pins identity before awaiting the pre-send hook", async () => {
  const entered = deferred(),
    release = deferred();
  let session = "old-session",
    attempt;
  const { chat, nodes } = fixture(
    async (command, args) => {
      if (command === "si_chat_state") return state(session, "");
      if (command === "si_status")
        return { connected: true, root: null, running: false };
      if (command === "si_chat_send") {
        attempt = args;
        if (args.expected_session !== session)
          throw Error("CONFLICT: conversation changed; message was not sent");
        throw Error("Old draft reached the replacement provider");
      }
      throw Error(command);
    },
    undefined,
    async () => {
      entered.resolve();
      await release.promise;
    },
  );
  try {
    chat.session = session;
    nodes.get("#si-prompt").value = "Original draft";
    const sending = chat.send();
    await entered.promise;
    session = "replacement-session";
    chat.session = session;
    release.resolve();
    await assert.rejects(sending, /CONFLICT: conversation changed/);
    assert.equal(attempt.expected_session, "old-session");
    assert.equal(nodes.get("#si-prompt").value, "Original draft");
    assert.equal(nodes.get("#si-send").disabled, true);
  } finally {
    release.resolve();
    chat.dispose();
  }
});

test("a rejected dirty draft remains local without a send or retry", async () => {
  let writes = 0,
    sends = 0;
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_state")
      return state("replacement-session", "Replacement draft");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    if (command === "si_chat_draft") {
      writes++;
      throw Error(
        "CONFLICT: conversation changed; old draft was not saved into the new session",
      );
    }
    if (command === "si_chat_send") {
      sends++;
      throw Error("Must not send");
    }
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "Unsent original";
    chat.draftDirty = true;
    await assert.rejects(chat.send(), /CONFLICT: conversation changed/);
    await chat.sync();
    await chat.flushDraft();
    await chat.send();
    assert.equal(writes, 1);
    assert.equal(sends, 0);
    assert.equal(nodes.get("#si-prompt").value, "Unsent original");
    assert.equal(nodes.get("#si-prompt").readOnly, true);
    assert.equal(nodes.get("#si-send").disabled, true);
  } finally {
    chat.dispose();
  }
});

test("session identity stays an exact string beyond JavaScript integer precision", async () => {
  const session = "9007199254740993";
  let expected;
  const { chat, nodes } = fixture(async (command, args) => {
    if (command === "si_chat_state") return state(session, "");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    if (command === "si_chat_send") {
      expected = args.expected_session;
      return { job_id: "safe" };
    }
    throw Error(command);
  });
  try {
    chat.session = session;
    nodes.get("#si-prompt").value = "Current service message";
    await chat.send();
    assert.equal(expected, session);
    assert.equal(typeof expected, "string");
  } finally {
    chat.dispose();
  }
});

test("an autosave conflict retains the local draft before any send", async () => {
  let writes = 0;
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_draft") {
      writes++;
      throw Error(
        "CONFLICT: conversation changed; old draft was not saved into the new session",
      );
    }
    if (command === "si_chat_state")
      return state("replacement-session", "Replacement draft");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "Unsent autosaved draft";
    chat.draftDirty = true;
    await assert.rejects(chat.flushDraft(), /CONFLICT: conversation changed/);
    await chat.sync();
    await chat.flushDraft();
    assert.equal(writes, 1);
    assert.equal(nodes.get("#si-prompt").value, "Unsent autosaved draft");
    assert.equal(nodes.get("#si-prompt").readOnly, true);
    assert.equal(nodes.get("#si-send").disabled, true);
  } finally {
    chat.dispose();
  }
});

test("a late rejected save cannot resurrect a draft explicitly cleared with New chat", async () => {
  const entered = [deferred(), deferred()],
    release = [deferred(), deferred()];
  let writes = 0,
    session = "session";
  const { chat, nodes } = fixture(async (command, args) => {
    if (command === "si_chat_draft") {
      const index = writes++;
      entered[index].resolve();
      await release[index].promise;
      if (args.session_id !== session)
        throw Error(
          "CONFLICT: conversation changed; old draft was not saved into the new session",
        );
      return { saved: true };
    }
    if (command === "si_chat_state") return state(session, "");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    if (command === "si_clear") {
      session = "explicit-new-chat";
      return {};
    }
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "First local draft";
    chat.draftDirty = true;
    const first = chat.flushDraft().catch((error) => error);
    await entered[0].promise;
    nodes.get("#si-prompt").value = "Latest local draft";
    chat.draftDirty = true;
    const second = chat.flushDraft().catch((error) => error);
    session = "replacement-session";
    release[0].resolve();
    await entered[1].promise;
    assert.match(String(await first), /CONFLICT: conversation changed/);
    assert.equal(nodes.get("#si-prompt").value, "Latest local draft");
    await nodes.get("#si-new").listeners.get("click")();
    assert.equal(chat.heldDraft, null);
    assert.equal(nodes.get("#si-prompt").value, "");
    release[1].resolve();
    assert.match(String(await second), /CONFLICT: conversation changed/);
    await chat.sync();
    assert.equal(chat.heldDraft, null);
    assert.equal(nodes.get("#si-prompt").value, "");
    assert.equal(nodes.get("#si-prompt").readOnly, false);
  } finally {
    for (const gate of release) gate.resolve();
    chat.dispose();
  }
});

test("new-session message rendering cannot enable a send with the previous draft", async () => {
  const entered = deferred(),
    release = deferred();
  let sends = 0;
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_state")
      return {
        ...state("replacement-session", "Replacement draft"),
        messages: [
          { id: "new", role: "assistant", content: "Replacement history" },
        ],
      };
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    if (command === "si_chat_send") {
      sends++;
      return { job_id: "unexpected" };
    }
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "Saved old-service draft";
    nodes.get("#si-prompt").disabled = false;
    nodes.get("#si-send").disabled = false;
    chat.append = async () => {
      entered.resolve();
      await release.promise;
    };
    const polling = chat.sync();
    await entered.promise;
    await chat.connection();
    await chat.send();
    assert.equal(sends, 0);
    assert.equal(nodes.get("#si-send").disabled, true);
    release.resolve();
    await polling;
    assert.equal(nodes.get("#si-prompt").value, "Replacement draft");
    assert.equal(nodes.get("#si-send").disabled, false);
  } finally {
    release.resolve();
    chat.dispose();
  }
});

test("a pending autosave conflict retains newer typing from the same draft", async () => {
  const entered = deferred(),
    release = deferred();
  let writes = 0,
    session = "session";
  const { chat, nodes } = fixture(async (command) => {
    if (command === "si_chat_draft") {
      writes++;
      entered.resolve();
      await release.promise;
      throw Error(
        "CONFLICT: conversation changed; old draft was not saved into the new session",
      );
    }
    if (command === "si_chat_state") return state(session, "Replacement draft");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    throw Error(command);
  });
  try {
    nodes.get("#si-prompt").value = "Older text";
    chat.draftDirty = true;
    const saving = chat.flushDraft();
    await entered.promise;
    nodes.get("#si-prompt").value = "Newer text not yet autosaved";
    nodes.get("#si-prompt").listeners.get("input")();
    session = "replacement-session";
    release.resolve();
    await assert.rejects(saving, /CONFLICT: conversation changed/);
    assert.equal(nodes.get("#si-prompt").value, "Newer text not yet autosaved");
    await chat.sync();
    await chat.flushDraft();
    assert.equal(nodes.get("#si-prompt").value, "Newer text not yet autosaved");
    assert.equal(chat.heldDraft.session, "session");
    assert.equal(nodes.get("#si-prompt").readOnly, true);
    assert.equal(writes, 1);
  } finally {
    release.resolve();
    chat.dispose();
  }
});

test("a rejected old-session autosave cannot replace a newer local draft", async () => {
  const entered = deferred(),
    release = deferred();
  let session = "session";
  const writes = [],
    sends = [];
  const { chat, nodes } = fixture(async (command, args) => {
    if (command === "si_chat_draft") {
      writes.push(args);
      if (args.session_id === "session") {
        entered.resolve();
        await release.promise;
        throw Error(
          "CONFLICT: conversation changed; old draft was not saved into the new session",
        );
      }
      assert.equal(args.session_id, session);
      return { saved: true };
    }
    if (command === "si_chat_state") return state(session, "Replacement draft");
    if (command === "si_status")
      return { connected: true, root: null, running: false };
    if (command === "si_chat_send") {
      assert.equal(args.expected_session, session);
      sends.push(args);
      return { job_id: "current-session-job" };
    }
    throw Error(command);
  });
  try {
    const prompt = nodes.get("#si-prompt");
    prompt.value = "Old session text";
    chat.draftDirty = true;
    const saving = chat.flushDraft();
    // Attach rejection handling before releasing the deferred response.
    const rejected = assert.rejects(saving, /CONFLICT: conversation changed/);
    await entered.promise;
    const oldDraft = chat.localDraft;
    session = "replacement-session";
    await chat.sync();
    prompt.value = "Newest text for replacement session";
    prompt.listeners.get("input")();
    const currentDraft = chat.localDraft;
    assert.notEqual(currentDraft, oldDraft);
    assert.equal(currentDraft.session, session);
    release.resolve();
    await rejected;
    assert.equal(chat.localDraft, currentDraft);
    assert.equal(chat.heldDraft, null);
    assert.equal(prompt.value, "Newest text for replacement session");
    assert.notEqual(prompt.readOnly, true);
    assert.equal(prompt.disabled, false);
    assert.equal(nodes.get("#si-send").disabled, false);
    assert.equal(chat.draftDirty, true);
    assert.equal(writes.length, 1, "Old failure must not retry an autosave");
    assert.equal(sends.length, 0, "Old failure must not submit provider work");
    await chat.send();
    assert.equal(writes.length, 2);
    assert.equal(writes[1].session_id, session);
    assert.equal(writes[1].text, "Newest text for replacement session");
    assert.equal(sends.length, 1);
    assert.equal(sends[0].expected_session, session);
    assert.equal(sends[0].prompt, "Newest text for replacement session");
  } finally {
    release.resolve();
    chat.dispose();
  }
});
