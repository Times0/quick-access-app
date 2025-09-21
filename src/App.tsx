import { useEffect, useMemo, useRef, useState } from "react";
import { Power, Plus, Check, Search, Clipboard } from "lucide-react";
import { enable, isEnabled, disable } from "@tauri-apps/plugin-autostart";
import { TrayIcon } from "@tauri-apps/api/tray";
import { Menu, MenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { exit } from "@tauri-apps/plugin-process";
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import "./global.css";

type KV = { key: string; value: string };

const STORAGE_KEY = "kv-entries";
// const PANEL_WIDTH = 420;
// const PANEL_HEIGHT = 720;

export default function App() {
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [trayIcon, setTrayIcon] = useState<TrayIcon | null>(null);

  console.log("trayIcon", trayIcon);

  const showHideMenuItemRef = useRef<MenuItem | null>(null);
  const togglingRef = useRef(false);

  // const showAtCursor = async () => {
  //   const win = getCurrentWindow();
  //   // set size to a tall, narrow panel
  //   await win.setSize(new LogicalSize(PANEL_WIDTH, PANEL_HEIGHT));

  //   // place top-left corner at current cursor
  //   try {
  //     const pos = await cursorPosition(); // desktop coordinates
  //     await win.setPosition(new PhysicalPosition(pos.x, pos.y));
  //   } catch {
  //     // fallback: just center if cursor position fails
  //     // (leaving out to keep it simple—Tauri centers on first show by default)
  //   }

  //   await win.show();
  //   await win.unminimize();
  //   await win.setFocus();

  //   if (showHideMenuItemRef.current) {
  //     await showHideMenuItemRef.current.setText("Hide Window");
  //   }
  // };

  const toggleWindowVisibility = async () => {
    if (togglingRef.current) return;
    togglingRef.current = true;
    try {
      const win = getCurrentWindow();
      const isMin = await win.isMinimized();
      const isVis = await win.isVisible();

      if (!isVis || isMin) {
        // Bring it back
        await win.show();
        await win.unminimize();
        await win.setFocus();
        if (showHideMenuItemRef.current) {
          await showHideMenuItemRef.current.setText("Hide Window");
        }
      } else {
        // Hide to tray
        await win.hide();
        if (showHideMenuItemRef.current) {
          await showHideMenuItemRef.current.setText("Show Window");
        }
      }
    } finally {
      // Small delay to avoid key-repeat immediately flipping it back
      setTimeout(() => {
        togglingRef.current = false;
      }, 150);
    }
  };

  useEffect(() => {
    let cleanup: (() => void) | undefined;

    const initialize = async () => {
      try {
        const win = getCurrentWindow();

        // Autostart status
        setAutostartEnabled(await isEnabled());

        // Create tray menu (labels reflect current visibility)
        const isVis = await win.isVisible();
        const showHideItem = await MenuItem.new({
          id: "show-hide",
          text: isVis ? "Hide Window" : "Show Window",
          action: toggleWindowVisibility,
        });
        showHideMenuItemRef.current = showHideItem;

        const quitItem = await MenuItem.new({
          id: "quit",
          text: "Quit",
          action: async () => {
            try {
              await unregisterAll();
            } finally {
              await exit();
            }
          },
        });

        const menu = await Menu.new({ items: [showHideItem, quitItem] });

        const tray = await TrayIcon.new({
          menu,
          menuOnLeftClick: false,
          tooltip: "Quick Access App — Ctrl+Shift+A to toggle",
          title: "Quick Access",
        });
        setTrayIcon(tray);

        // Global shortcut — register ONCE
        await register("CmdOrCtrl+Shift+A", toggleWindowVisibility);

        // Intercept window close: hide to tray instead
        const unlistenClose = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          await win.hide();
          if (showHideMenuItemRef.current) {
            await showHideMenuItemRef.current.setText("Show Window");
          }
        });

        // If the window gains focus after being restored, ensure the menu text is correct
        const unlistenFocus = await win.onFocusChanged(async ({ payload }) => {
          if (payload && showHideMenuItemRef.current) {
            await showHideMenuItemRef.current.setText("Hide Window");
          }
        });

        cleanup = () => {
          unlistenClose();
          unlistenFocus();
          unregisterAll().catch(() => {});
          tray.close().catch(() => {});
        };
      } catch (e) {
        console.error("Initialization failed:", e);
      } finally {
        setLoading(false);
      }
    };

    initialize();
    return () => {
      if (cleanup) cleanup();
    };
    // IMPORTANT: empty deps — do NOT re-register the shortcut on state changes
  }, []);

  const toggleAutostart = async () => {
    try {
      if (autostartEnabled) {
        await disable();
        setAutostartEnabled(false);
      } else {
        await enable();
        setAutostartEnabled(true);
      }
    } catch (e) {
      console.error("Failed to toggle autostart:", e);
    }
  };

  return (
    <div className="bg-gray-50 py-4 px-4 h-screen">
      <div className="max-w-3xl mx-auto">
        {/* Header / Controls */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-gray-900">
                Quick Key/Value
              </h3>
              <span className="text-xs text-gray-500">
                Press{" "}
                <kbd className="px-1 py-0.5 bg-gray-100 rounded text-xs">
                  Ctrl+Shift+A
                </kbd>{" "}
                to pop open at cursor
              </span>
            </div>
            <button
              onClick={toggleAutostart}
              disabled={loading}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors ${
                autostartEnabled
                  ? "bg-green-100 text-green-800 hover:bg-green-200"
                  : "bg-gray-100 text-gray-600 hover:bg-gray-200"
              } disabled:opacity-50 disabled:cursor-not-allowed`}
              title="Launch on startup"
            >
              <Power size={16} />
              {loading
                ? "Loading..."
                : autostartEnabled
                ? "Enabled"
                : "Disabled"}
            </button>
          </div>
        </div>

        {/* Searcher */}
        <KVSearcher />
      </div>
    </div>
  );
}

/* --------------------------------------------
   Keyboard-first KV searcher with add flow
---------------------------------------------*/
function KVSearcher() {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<KV[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KV[]) : [];
  });
  const [selected, setSelected] = useState(0);
  const [adding, setAdding] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);
  const addKeyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }, [items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (x) =>
        x.key.toLowerCase().includes(q) || x.value.toLowerCase().includes(q)
    );
  }, [items, query]);

  useEffect(() => {
    // keep selected in range
    if (selected > Math.max(0, filtered.length - 1)) {
      setSelected(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selected]);

  // keyboard handlers for list
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if (adding) {
        // in add mode, Esc cancels; Enter saves in form submit
        if (e.key === "Escape") {
          e.preventDefault();
          setAdding(false);
          setNewKey("");
          setNewValue("");
          setTimeout(() => inputRef.current?.focus(), 0);
        }
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, Math.max(filtered.length - 1, 0)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (filtered[selected]) {
          await copyText(filtered[selected].value);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        e.preventDefault();
        if (filtered[selected]) {
          await copyText(filtered[selected].value);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setAdding(true);
        setTimeout(() => addKeyRef.current?.focus(), 0);
      } else if (e.key === "/") {
        // quick focus search
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, filtered, selected]);

  const submitNew = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKey.trim()) return;
    const idx = items.findIndex((x) => x.key === newKey.trim());
    let next = [...items];
    if (idx >= 0) next[idx] = { key: newKey.trim(), value: newValue };
    else next.unshift({ key: newKey.trim(), value: newValue });

    setItems(next);
    setAdding(false);
    setNewKey("");
    setNewValue("");
    setQuery(newKey.trim());
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-3 border-b border-gray-100 flex items-center gap-2">
        <Search size={16} className="text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Search keys or values…"
          className="flex-1 outline-none text-sm"
          aria-label="Search"
        />
        <button
          onClick={() => {
            setAdding(true);
            setTimeout(() => addKeyRef.current?.focus(), 0);
          }}
          className="px-2 py-1 rounded-md text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center gap-1"
          title="Add (Ctrl/Cmd+N)"
        >
          <Plus size={14} /> Add
        </button>
      </div>

      {/* List */}
      <div
        className="max-h-[560px] overflow-auto divide-y divide-gray-100"
        role="listbox"
        aria-label="Key value list"
      >
        {filtered.length === 0 && (
          <div className="p-4 text-sm text-gray-500">No matches.</div>
        )}
        {filtered.map((item, i) => {
          const active = i === selected;
          return (
            <button
              key={item.key + i}
              role="option"
              aria-selected={active}
              onClick={() => copyText(item.value)}
              className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 ${
                active ? "bg-blue-50" : "hover:bg-gray-50"
              }`}
            >
              <div className="min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">
                  {item.key}
                </div>
                <div className="text-[12px] text-gray-500 truncate">
                  {item.value}
                </div>
              </div>
              <Clipboard size={16} className="shrink-0 text-gray-400" />
            </button>
          );
        })}
      </div>

      {/* Add Drawer */}
      {adding && (
        <div className="border-t border-gray-100 p-3 bg-gray-50">
          <form onSubmit={submitNew} className="flex flex-col gap-2">
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-xs text-gray-600 col-span-1">Key</label>
              <input
                ref={addKeyRef}
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                className="col-span-2 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-blue-200"
                placeholder="my_api_key"
                required
              />
            </div>
            <div className="grid grid-cols-3 gap-2 items-center">
              <label className="text-xs text-gray-600 col-span-1">Value</label>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="col-span-2 bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm outline-none focus:ring-2 ring-blue-200"
                placeholder="••••••"
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setNewKey("");
                  setNewValue("");
                  inputRef.current?.focus();
                }}
                className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Cancel (Esc)
              </button>
              <button
                type="submit"
                className="text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1"
              >
                <Check size={14} /> Save (Enter)
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Hints */}
      <div className="p-2 text-[11px] text-gray-500 bg-white border-t border-gray-100 flex flex-wrap gap-x-3 gap-y-1">
        <kbd className="px-1 py-0.5 bg-gray-100 rounded">↑/↓</kbd> navigate
        <kbd className="px-1 py-0.5 bg-gray-100 rounded">Enter</kbd> copy value
        <kbd className="px-1 py-0.5 bg-gray-100 rounded">Ctrl/Cmd+C</kbd> copy
        <kbd className="px-1 py-0.5 bg-gray-100 rounded">/</kbd> focus search
        <kbd className="px-1 py-0.5 bg-gray-100 rounded">Ctrl/Cmd+N</kbd> add
      </div>
    </div>
  );
}

/* --------------------------------------------
   Helpers
---------------------------------------------*/
async function copyText(text: string) {
  try {
    // navigator.clipboard works in Tauri’s webview; swap for plugin if preferred
    await navigator.clipboard.writeText(text ?? "");
  } catch (e) {
    console.error("Clipboard failed, fallback:", e);
    // basic fallback
    const ta = document.createElement("textarea");
    ta.value = text ?? "";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}
