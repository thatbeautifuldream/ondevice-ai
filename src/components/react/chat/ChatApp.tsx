import { useEffect, useReducer, useRef, useState } from "react";
import { ChatAgent } from "../../../lib/chat/agent";
import * as store from "../../../lib/chat/store";
import { WIKIPEDIA_TOOLS } from "../../../lib/chat/tools/wikipedia";
import type { TChatMessage, TSettings } from "../../../lib/chat/types";
import { Icon } from "../Icon";
import { Sidebar } from "./Sidebar";
import { Composer } from "./Composer";
import { SettingsDialog } from "./SettingsDialog";
import { EmptyState, Message, UnavailableNotice } from "./Messages";

const STORAGE_SIDEBAR = "oda.sidebar.v1";

function truncate(s: string, n = 48): string {
	const t = s.trim().replace(/\s+/g, " ");
	return t.length > n ? `${t.slice(0, n)}…` : t || "New chat";
}

function isDesktop(): boolean {
	return window.matchMedia("(min-width: 1024px)").matches;
}

function contextBarColor(ratio: number): string {
	if (ratio >= 0.9) return "bg-accent";
	if (ratio >= 0.7) return "bg-zinc-500 dark:bg-zinc-400";
	return "bg-zinc-400 dark:bg-zinc-500";
}

export default function ChatApp() {
	// The store module stays the single source of truth for conversations; React
	// re-renders off this version counter after every mutation.
	const [, bump] = useReducer((c: number) => c + 1, 0);

	// Always open on a fresh chat — past conversations stay in the sidebar but
	// are never silently resumed.
	const [settings, setSettingsState] = useState<TSettings>(() => {
		store.load();
		store.startNew();
		return store.loadSettings();
	});
	const settingsRef = useRef(settings);
	settingsRef.current = settings;

	const [availability, setAvailability] = useState<ChatAgent["availability"]>(null);
	const [downloading, setDownloading] = useState(false);
	const [downloadProgress, setDownloadProgress] = useState(0);
	const [compacting, setCompacting] = useState(false);
	const [compactStatus, setCompactStatus] = useState<string | null>(null);
	const [isGenerating, setIsGenerating] = useState(false);
	const [generatingId, setGeneratingId] = useState<string | null>(null);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const [sidebarCollapsed, setSidebarCollapsedState] = useState(() => {
		try {
			return localStorage.getItem(STORAGE_SIDEBAR) === "1";
		} catch {
			return false;
		}
	});
	const [settingsOpen, setSettingsOpen] = useState(false);

	const abortRef = useRef<AbortController | null>(null);
	const scrollerRef = useRef<HTMLDivElement>(null);
	const compactHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const showCompactStatus = (message: string, autoHideMs?: number) => {
		setCompactStatus(message);
		if (compactHideTimer.current) {
			clearTimeout(compactHideTimer.current);
			compactHideTimer.current = null;
		}
		if (autoHideMs) {
			compactHideTimer.current = setTimeout(() => setCompactStatus(null), autoHideMs);
		}
	};

	// The agent never touches the DOM; its hooks feed React state instead.
	const agentRef = useRef<ChatAgent | null>(null);
	if (!agentRef.current) {
		agentRef.current = new ChatAgent({
			settings: () => settingsRef.current,
			tools: () => (settingsRef.current.toolsEnabled ? WIKIPEDIA_TOOLS : []),
			hooks: {
				onAvailabilityChange: (availability) => setAvailability(availability),
				onDownloadStart: () => {
					setDownloadProgress(0);
					setDownloading(true);
				},
				onDownloadProgress: (fraction) => setDownloadProgress(Math.max(0, Math.min(1, fraction))),
				onDownloadEnd: () => setDownloading(false),
				onContextChange: () => bump(),
				onCompactingChange: (compacting) => setCompacting(compacting),
				onCompactStatus: (message, autoHideMs) => showCompactStatus(message, autoHideMs),
			},
		});
	}
	const agent = agentRef.current;

	useEffect(() => {
		void agent.boot();
	}, [agent]);

	// Keyboard: Cmd/Ctrl+B toggles the sidebar, Esc closes the mobile drawer.
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
				e.preventDefault();
				toggleSidebar();
				return;
			}
			if (e.key === "Escape") setSidebarOpen(false);
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	});

	const setSidebarCollapsed = (collapsed: boolean) => {
		setSidebarCollapsedState(collapsed);
		try {
			localStorage.setItem(STORAGE_SIDEBAR, collapsed ? "1" : "0");
		} catch {
			/* ignore */
		}
	};

	const toggleSidebar = () => {
		if (isDesktop()) setSidebarCollapsed(!sidebarCollapsed);
		else setSidebarOpen((open) => !open);
	};

	const scrollToBottom = (force = false) => {
		requestAnimationFrame(() => {
			const scroller = scrollerRef.current;
			if (!scroller) return;
			if (force) {
				scroller.scrollTop = scroller.scrollHeight;
				return;
			}
			const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
			if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
		});
	};

	// -------------------------------------------------------------------------
	// Actions
	// -------------------------------------------------------------------------

	const sendMessage = async (text: string) => {
		const trimmed = text.trim();
		if (!trimmed || isGenerating || agent.compacting) return;
		if (agent.availability === "unavailable") return;

		const conv = store.current() ?? store.create();

		// Append the user message + an assistant placeholder and render
		// immediately, before any async work (session creation can be slow).
		const userMsg: TChatMessage = { id: store.uid(), role: "user", content: trimmed };
		const assistantMsg: TChatMessage = {
			id: store.uid(),
			role: "assistant",
			content: "",
			streaming: true,
			model: settingsRef.current.modelId,
		};
		conv.messages.push(userMsg, assistantMsg);
		const userCount = conv.messages.filter((m) => m.role === "user").length;
		if (userCount === 1) conv.title = truncate(trimmed);
		conv.updatedAt = Date.now();
		store.save();

		setIsGenerating(true);
		setGeneratingId(conv.id);
		abortRef.current = new AbortController();
		bump();
		scrollToBottom(true);

		let lastRender = 0;

		// Runs on the terminal event (done / aborted / error): persist, then let
		// React refresh the finished message and the chrome.
		const finalize = () => {
			assistantMsg.streaming = false;
			setIsGenerating(false);
			setGeneratingId(null);
			abortRef.current = null;
			store.save();
			bump();
			scrollToBottom();
		};

		// Drive the agent loop. Terminal events always arrive with the agent's
		// session bookkeeping already settled, so the UI only mirrors them.
		for await (const event of agent.run(conv, trimmed, abortRef.current.signal)) {
			switch (event.type) {
				case "chunk": {
					assistantMsg.content = event.content;
					const now = performance.now();
					if (now - lastRender > 40) {
						lastRender = now;
						bump();
						scrollToBottom();
					}
					break;
				}
				case "tool_start": {
					// A new model turn follows the tool result; clear any pre-call text.
					assistantMsg.content = "";
					assistantMsg.tools = [...(assistantMsg.tools ?? []), { tool: event.tool, args: event.args }];
					bump();
					scrollToBottom();
					break;
				}
				case "tool_end": {
					const uses = assistantMsg.tools ?? [];
					const last = uses[uses.length - 1];
					if (last && last.tool === event.tool && last.ok === undefined) {
						last.ok = event.ok;
						last.result = event.content;
					}
					bump();
					break;
				}
				case "done": {
					assistantMsg.content = event.content;
					finalize();
					break;
				}
				case "aborted": {
					// Keep the partial text; with nothing streamed, drop the placeholder
					// but keep the user message so they can retry.
					assistantMsg.content = event.content;
					if (!event.content) {
						const idx = conv.messages.indexOf(assistantMsg);
						if (idx !== -1) conv.messages.splice(idx, 1);
					}
					conv.updatedAt = Date.now();
					finalize();
					break;
				}
				case "error": {
					assistantMsg.error = true;
					assistantMsg.content = event.message;
					conv.updatedAt = Date.now();
					finalize();
					break;
				}
				case "compacted":
					// Compaction progress is surfaced through the agent hooks.
					break;
			}
		}
	};

	const regenerate = async () => {
		const conv = store.current();
		if (!conv || isGenerating) return;
		let lastUserIdx = -1;
		for (let i = conv.messages.length - 1; i >= 0; i--) {
			if (conv.messages[i].role === "user") {
				lastUserIdx = i;
				break;
			}
		}
		if (lastUserIdx === -1) return;
		const text = conv.messages[lastUserIdx].content;
		conv.messages.splice(lastUserIdx);
		// Trimming can leave a compaction pointing past the new length; drop it so
		// the fresh session rebuilds from the (full) trimmed history.
		conv.compaction = undefined;
		agent.destroySession(conv.id);
		store.save();
		bump();
		await sendMessage(text);
	};

	const deleteConversation = (id: string) => {
		agent.destroySession(id);
		store.remove(id);
		bump();
	};

	const newChat = () => {
		store.startNew();
		setCompactStatus(null);
		setSidebarOpen(false);
		bump();
	};

	const selectConversation = (id: string) => {
		store.setCurrent(id);
		setCompactStatus(null);
		setSidebarOpen(false);
		bump();
		scrollToBottom(true);
	};

	const updateSettings = (patch: Partial<TSettings>) => {
		const next = { ...settingsRef.current, ...patch };
		setSettingsState(next);
		store.saveSettings(next);
		agent.invalidateSessions();
		// Switching models changes availability and parameter support.
		if (patch.modelId) void agent.boot();
	};

	const clearAll = () => {
		for (const c of [...store.list()]) deleteConversation(c.id);
		agent.destroySummarizers();
		store.startNew();
		store.save();
		setSettingsOpen(false);
		bump();
	};

	// -------------------------------------------------------------------------
	// Derived render state
	// -------------------------------------------------------------------------

	const conv = store.current();
	const messages = conv?.messages ?? [];
	const hasMessages = messages.length > 0;
	const unavailable = availability === "unavailable";
	const contextInfo = conv && !compacting ? agent.contextInfo(conv.id) : null;
	const contextRatio = contextInfo ? Math.min(1, contextInfo.usage / contextInfo.window) : 0;
	const downloadPct = Math.round(downloadProgress * 100);

	return (
		<div className="flex h-dvh overflow-hidden isolate">
			<Sidebar
				conversations={store.list()}
				currentId={store.getCurrentId()}
				availability={availability}
				modelId={settings.modelId}
				open={sidebarOpen}
				collapsed={sidebarCollapsed}
				onClose={() => setSidebarOpen(false)}
				onNewChat={newChat}
				onSelect={selectConversation}
				onDelete={deleteConversation}
				onOpenSettings={() => setSettingsOpen(true)}
			/>

			<main className="flex min-w-0 flex-1 flex-col bg-white dark:bg-zinc-950">
				<header className="flex h-14 shrink-0 items-center gap-2 px-3 sm:px-4">
					<button
						type="button"
						onClick={toggleSidebar}
						className="relative flex size-9 items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
						aria-label="Toggle conversations"
					>
						<span className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
						<Icon name="bars-3" />
					</button>

					<h2 className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight">{conv?.title || "New chat"}</h2>

					{(compacting || contextInfo) && (
						<div
							className="hidden items-center gap-2 rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-500 sm:flex dark:bg-white/5 dark:text-zinc-400"
							title="Context window usage"
						>
							<span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10">
								<span
									className={
										compacting
											? "block h-full rounded-full bg-accent animate-pulse transition-all duration-300"
											: `block h-full rounded-full ${contextBarColor(contextRatio)} transition-all duration-300`
									}
									style={{ width: compacting ? "100%" : `${Math.round(contextRatio * 100)}%` }}
								></span>
							</span>
							<span className="tabular-nums">{compacting ? "Compacting" : `${Math.round(contextRatio * 100)}%`}</span>
						</div>
					)}
				</header>

				<div ref={scrollerRef} className="scrollbar-thin flex flex-1 flex-col overflow-y-auto">
					{unavailable && <UnavailableNotice onOpenSettings={() => setSettingsOpen(true)} />}

					{!unavailable && !hasMessages && (
						<div className="grid min-h-full place-items-center">
							<EmptyState onSuggestion={(prompt) => void sendMessage(prompt)} />
						</div>
					)}

					{hasMessages && (
						<ol className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8" role="list">
							{messages.map((m, i) => (
								<Message
									key={m.id}
									role={m.role}
									content={m.content}
									streaming={m.streaming}
									error={m.error}
									tools={m.tools}
									model={m.model}
									toolsKey={JSON.stringify(m.tools ?? null)}
									isLast={i === messages.length - 1}
									onRegenerate={() => void regenerate()}
								/>
							))}
						</ol>
					)}

					{downloading && (
						<div className="mx-auto w-full max-w-3xl px-4">
							<div className="flex items-center gap-3 rounded-xl bg-zinc-50 p-4 dark:bg-white/5">
								<span className="text-accent">
									<Icon name="sparkles" className="size-4" />
								</span>
								<div className="min-w-0 flex-1">
									<p className="text-sm font-medium text-zinc-900 dark:text-white">Downloading the on-device model</p>
									<p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
										{downloadPct > 0 ? `${downloadPct}% downloaded` : "Starting download…"}
									</p>
									<div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10">
										<div
											className="h-full rounded-full bg-accent transition-all"
											style={{ width: `${downloadPct}%` }}
										></div>
									</div>
								</div>
							</div>
						</div>
					)}

					{compactStatus && (
						<div className="mx-auto w-full max-w-3xl px-4">
							<div className="flex items-center gap-2 rounded-xl bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-white/5 dark:text-zinc-300">
								<span className="text-accent">
									<Icon name="arrow-path" className="size-4" />
								</span>
								<span className="min-w-0 flex-1">{compactStatus}</span>
							</div>
						</div>
					)}
				</div>

				<Composer
					showStop={isGenerating && generatingId === store.getCurrentId()}
					isGenerating={isGenerating}
					blocked={unavailable || compacting}
					onSend={(text) => void sendMessage(text)}
					onStop={() => abortRef.current?.abort()}
				/>
			</main>

			<SettingsDialog
				open={settingsOpen}
				settings={settings}
				modelParams={agent.modelParams}
				onClose={() => setSettingsOpen(false)}
				onChange={updateSettings}
				onClearAll={clearAll}
			/>
		</div>
	);
}
