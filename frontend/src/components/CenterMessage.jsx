import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

/**
 * Centered messages for the whole app (replaces the corner toasts).
 *
 *   toast.error("...") / toast.success("...") / toast.info("...") / toast.warn("...")
 *     -> opens a popup in the middle of the screen with an OK button.
 *        Success / info messages close by themselves after a moment; errors and warnings wait for OK.
 *   promptName("Enter document name")
 *     -> opens a centered popup with a text box and resolves with the typed text (or null if cancelled).
 *
 * Mount <CenterMessageHost /> once (main.jsx). Existing `toast.xxx(...)` calls only need their import changed.
 */
let messages = [];
let nextId = 1;
let promptRequest = null; // { title, label, placeholder, resolve }
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn({ messages, promptRequest }));

const asText = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value.message === "string") return value.message;
  return value == null ? "" : String(value);
};

const push = (type) => (value) => {
  const message = asText(value).trim();
  if (!message) return null;
  if (messages.some((m) => m.type === type && m.message === message)) return null;
  const id = nextId++;
  messages = [...messages, { id, type, message }];
  emit();
  return id;
};

const warn = push("warning");
export const toast = Object.assign((value) => push("info")(value), {
  success: push("success"),
  error: push("error"),
  info: push("info"),
  warn,
  warning: warn,
  dismiss: () => {
    messages = [];
    emit();
  },
});

export const promptName = (title = "Enter document name", { label = "Document name", placeholder = "Type a name" } = {}) =>
  new Promise((resolve) => {
    promptRequest?.resolve(null);
    promptRequest = { title, label, placeholder, resolve };
    emit();
  });

const SEVERITY = ["error", "warning", "info", "success"];
const STYLES = {
  error: { title: "Something went wrong", Icon: XCircle, iconCls: "text-red-600", ringCls: "bg-red-100" },
  warning: { title: "Please check", Icon: AlertTriangle, iconCls: "text-amber-600", ringCls: "bg-amber-100" },
  info: { title: "Notice", Icon: Info, iconCls: "text-blue-600", ringCls: "bg-blue-100" },
  success: { title: "Done", Icon: CheckCircle2, iconCls: "text-green-600", ringCls: "bg-green-100" },
};

export default function CenterMessageHost() {
  const [state, setState] = useState({ messages, promptRequest });
  const [text, setText] = useState("");
  const inputRef = useRef(null);

  useEffect(() => {
    listeners.add(setState);
    return () => listeners.delete(setState);
  }, []);

  const current = state.messages;
  const request = state.promptRequest;

  const closeMessages = () => {
    messages = [];
    emit();
  };

  // Success / info messages close on their own; errors and warnings stay until OK.
  const autoClose = current.length > 0 && current.every((m) => m.type === "success" || m.type === "info");
  useEffect(() => {
    if (!autoClose) return undefined;
    const timer = setTimeout(closeMessages, 2500);
    return () => clearTimeout(timer);
  }, [current, autoClose]);

  useEffect(() => {
    if (request) {
      setText("");
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [request]);

  useEffect(() => {
    if (!current.length || request) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" || e.key === "Enter") {
        e.preventDefault();
        closeMessages();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, request]);

  const finishPrompt = (value) => {
    const pending = promptRequest;
    promptRequest = null;
    emit();
    pending?.resolve(value);
  };

  if (request) {
    const submit = () => {
      const value = text.trim();
      if (!value) return;
      finishPrompt(value);
    };
    return (
      <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => finishPrompt(null)}>
        <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
          <h3 className="text-base font-semibold text-gray-900">{request.title}</h3>
          <label className="mt-3 block text-sm font-medium text-gray-700">{request.label}</label>
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "Escape") finishPrompt(null);
            }}
            placeholder={request.placeholder}
            className="mt-1.5 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm outline-none focus:border-gray-500"
          />
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => finishPrompt(null)} className="rounded-lg border px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={!text.trim()}
              className="rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!current.length) return null;

  const top = SEVERITY.find((type) => current.some((m) => m.type === type)) || "info";
  const { title, Icon, iconCls, ringCls } = STYLES[top];

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 p-4" onMouseDown={closeMessages} role="alertdialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-center shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${ringCls}`}>
          <Icon size={26} className={iconCls} />
        </div>
        <h3 className="mt-3 text-base font-semibold text-gray-900">{title}</h3>
        <div className="mt-2 max-h-60 space-y-2 overflow-y-auto text-sm text-gray-700">
          {current.map((m) => (
            <p key={m.id}>{m.message}</p>
          ))}
        </div>
        <button type="button" autoFocus onClick={closeMessages} className="mt-5 w-full rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800">
          OK
        </button>
      </div>
    </div>
  );
}
