import { marked } from "marked";
import { icon } from "../lib/icons";
import { ChatAgent } from "../lib/chat/agent";
import * as store from "../lib/chat/store";
import type { TAvailability } from "../lib/chat/agent";
import type { TChatMessage } from "../lib/chat/types";

// ---------------------------------------------------------------------------
// UI state
// ---------------------------------------------------------------------------

const STORAGE_SIDEBAR = "oda.sidebar.v1";

const state = {
	settings: store.loadSettings(),
	isGenerating: false,
	generatingId: null as string | null,
	abort: null as AbortController | null,
};

// The agent never touches the DOM; these hooks wire its notifications to the
// UI (function declarations below are hoisted, so forward references are fine).
const agent = new ChatAgent({
	settings: () => state.settings,
	hooks: {
		onAvailabilityChange: () => {
			updateModelStatus();
			updateComposer();
			updateEmptyStateNotice();
		},
		onDownloadStart: () => showDownloadBanner(),
		onDownloadProgress: (fraction) => setDownloadProgress(fraction),
		onDownloadEnd: () => hideDownloadBanner(),
		onContextChange: () => updateContextPill(),
		onCompactingChange: () => {
			updateComposer();
			updateContextPill();
		},
		onCompactStatus: (message, autoHideMs) => showCompactStatus(message, autoHideMs),
	},
});

function deleteConversation(id: string): void {
	agent.destroySession(id);
	store.remove(id);
}

// ---------------------------------------------------------------------------
// Markdown + sanitization
// ---------------------------------------------------------------------------

marked.setOptions({ gfm: true, breaks: true });

const ALLOWED_TAG_REMOVAL = ["script", "style", "iframe", "object", "embed", "link", "meta", "form"];

function sanitizeHtml(dirty: string): string {
	const tpl = document.createElement("template");
	tpl.innerHTML = dirty;
	const root = tpl.content;
	for (const tag of ALLOWED_TAG_REMOVAL) {
		root.querySelectorAll(tag).forEach((el) => el.remove());
	}
	root.querySelectorAll("*").forEach((el) => {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			const value = attr.value;
			if (name.startsWith("on")) {
				el.removeAttribute(attr.name);
			} else if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
				el.removeAttribute(attr.name);
			}
		}
	});
	return tpl.innerHTML;
}

function escapeHtml(s: string): string {
	return s.replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
	);
}

function renderMarkdown(text: string): string {
	if (!text.trim()) return "";
	try {
		return sanitizeHtml(marked.parse(text, { async: false }) as string);
	} catch {
		return escapeHtml(text);
	}
}

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector(sel) as T;

const els = {
	sidebar: () => $("#sidebar"),
	backdrop: () => $("#sidebar-backdrop"),
	conversationList: () => $("#conversation-list") as HTMLElement,
	noConvos: () => $("#no-conversations") as HTMLElement,
	newChatBtn: () => $("#new-chat-btn") as HTMLButtonElement,
	menuBtn: () => $("#menu-btn") as HTMLButtonElement,
	sidebarClose: () => $("#sidebar-close") as HTMLButtonElement,
	settingsBtn: () => $("#settings-btn") as HTMLButtonElement,
	modelStatus: () => $("#model-status") as HTMLElement,

	chatTitle: () => $("#chat-title") as HTMLElement,
	contextPill: () => $("#context-pill") as HTMLElement,
	contextBar: () => $("#context-bar") as HTMLElement,
	contextText: () => $("#context-text") as HTMLElement,

	emptyState: () => $("#empty-state") as HTMLElement,
	messageList: () => $("#message-list") as HTMLOListElement,
	messagesScroll: () => $("#messages-scroll") as HTMLElement,
	downloadBanner: () => $("#download-banner") as HTMLElement,
	downloadBar: () => $("#download-bar") as HTMLElement,
	downloadStatus: () => $("#download-status") as HTMLElement,
	compactBanner: () => $("#compact-banner") as HTMLElement,
	compactStatus: () => $("#compact-status") as HTMLElement,
	unavailableNotice: () => $("#unavailable-notice") as HTMLElement,

	composerForm: () => $("#composer-form") as HTMLFormElement,
	composerInput: () => $("#composer-input") as HTMLTextAreaElement,
	sendBtn: () => $("#send-btn") as HTMLButtonElement,
	sendIcon: () => $("#send-icon") as HTMLElement,
	stopIcon: () => $("#stop-icon") as HTMLElement,

	settingsDialog: () => $("#settings-dialog") as HTMLDialogElement,
	settingsClose: () => $("#settings-close") as HTMLButtonElement,
	settingSystem: () => $("#setting-system") as HTMLTextAreaElement,
	paramControls: () => $("#param-controls") as HTMLElement,
	settingTemperature: () => $("#setting-temperature") as HTMLInputElement,
	temperatureValue: () => $("#temperature-value") as HTMLElement,
	settingTopk: () => $("#setting-topk") as HTMLInputElement,
	topkValue: () => $("#topk-value") as HTMLElement,
	clearAllBtn: () => $("#clear-all-btn") as HTMLButtonElement,
};

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function truncate(s: string, n = 48): string {
	const t = s.trim().replace(/\s+/g, " ");
	return t.length > n ? `${t.slice(0, n)}…` : t || "New chat";
}

function renderSidebar(): void {
	const list = els.conversationList();
	const convos = store.list();
	els.noConvos().classList.toggle("hidden", convos.length > 0);

	list.replaceChildren(
		...convos.map((conv) => {
			const li = document.createElement("li");
			li.className = "group relative";
			li.dataset.id = conv.id;

			const active = conv.id === store.getCurrentId();
			const btn = document.createElement("button");
			btn.type = "button";
			btn.className =
				"relative flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
				(active
					? "bg-zinc-950/5 text-zinc-900 dark:bg-white/10 dark:text-white"
					: "text-zinc-600 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white");
			btn.innerHTML =
				`<span class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>` +
				`<span class="truncate pr-7">${escapeHtml(conv.title || "New chat")}</span>`;

			const del = document.createElement("button");
			del.type = "button";
			del.className =
				"absolute top-1/2 right-1.5 -translate-y-1/2 flex size-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-950/10 hover:text-zinc-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-zinc-300";
			del.setAttribute("aria-label", "Delete conversation");
			del.innerHTML =
				`<span class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>` +
				icon("trash");

			li.append(btn, del);
			return li;
		}),
	);
}

function renderHeader(): void {
	const conv = store.current();
	els.chatTitle().textContent = conv?.title || "New chat";
}

function messageActionsHtml(msg: TChatMessage, isLast: boolean): string {
	let html = `<div class="mt-2 flex items-center gap-1">`;
	html += `<button type="button" class="msg-copy relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200">
		<span class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
		<span class="copy-idle flex items-center gap-1.5">${icon("clipboard")}Copy</span>
		<span class="copy-done hidden items-center gap-1.5 text-accent">${icon("check")}Copied</span>
	</button>`;
	if (isLast && msg.role === "assistant" && !msg.streaming) {
		html += `<button type="button" class="msg-regen relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200">
			<span class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
			${icon("arrow-path")}Regenerate
		</button>`;
	}
	html += `</div>`;
	return html;
}

function createMessageEl(msg: TChatMessage, isLast: boolean): HTMLLIElement {
	const li = document.createElement("li");
	li.className = "msg-row";
	li.dataset.id = msg.id;
	li.setAttribute("role", "listitem");

	if (msg.role === "user") {
		li.className = "flex justify-end";
		const bubble = document.createElement("div");
		bubble.className =
			"max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-base text-accent-fg shadow-sm dark:shadow-none";
		bubble.textContent = msg.content;
		li.append(bubble);
	} else {
		li.className = "flex gap-3";
		const avatar = document.createElement("div");
		avatar.className = "mt-0.5 shrink-0 text-accent";
		avatar.innerHTML = icon("sparkles", "size-4");

		const body = document.createElement("div");
		body.className = "min-w-0 flex-1";
		const content = document.createElement("div");
		content.className = "msg-content prose-chat max-w-[72ch]";
		body.append(content);

		const actionsWrap = document.createElement("div");
		actionsWrap.className = "msg-actions";
		actionsWrap.innerHTML = messageActionsHtml(msg, isLast);
		body.append(actionsWrap);

		li.append(avatar, body);
		updateMessageContent(li, msg);
	}

	return li;
}

function updateMessageContent(li: HTMLElement, msg: TChatMessage): void {
	const content = li.querySelector(".msg-content");
	if (!content) return;

	if (msg.error) {
		content.className =
			"msg-content flex items-start gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-white/5 dark:text-zinc-300";
		content.innerHTML =
			`<span class="mt-0.5 shrink-0">${icon("exclamation-triangle")}</span><div>${escapeHtml(
				msg.content || "Something went wrong.",
			)}</div>`;
		li.querySelector(".msg-actions")?.toggleAttribute("hidden", true);
		return;
	}

	if (msg.streaming && !msg.content) {
		content.className = "msg-content";
		content.innerHTML =
			`<span class="flex items-center gap-1 py-1.5">` +
			`<span class="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s] dark:bg-zinc-500"></span>` +
			`<span class="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s] dark:bg-zinc-500"></span>` +
			`<span class="size-1.5 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"></span>` +
			`</span>`;
		li.querySelector(".msg-actions")?.toggleAttribute("hidden", true);
		return;
	}

	content.className = "msg-content prose-chat max-w-[72ch]";
	content.innerHTML = renderMarkdown(msg.content);
	li.querySelector(".msg-actions")?.toggleAttribute("hidden", false);
}

function renderMessages(): void {
	const conv = store.current();
	const list = els.messageList();
	const hasMessages = !!conv && conv.messages.length > 0;

	els.emptyState().classList.toggle("hidden", hasMessages);
	list.classList.toggle("hidden", !hasMessages);
	list.classList.toggle("flex", hasMessages);

	if (!conv) {
		list.replaceChildren();
		return;
	}

	list.replaceChildren(
		...conv.messages.map((m, i) => createMessageEl(m, i === conv.messages.length - 1)),
	);
	scrollToBottom(true);
}

function renderAll(): void {
	renderSidebar();
	renderMessages();
	renderHeader();
	updateContextPill();
}

// ---------------------------------------------------------------------------
// Status / banners
// ---------------------------------------------------------------------------

function updateModelStatus(): void {
	const el = els.modelStatus();
	const dot = el.querySelector("span:first-child") as HTMLElement;
	const label = el.querySelector("span:last-child") as HTMLElement;
	if (!dot || !label) return;

	const dotBase = "size-2 shrink-0 rounded-full ";
	const map: Record<TAvailability, { dot: string; text: string }> = {
		available: { dot: dotBase + "bg-accent", text: "Ready · Gemini Nano" },
		downloadable: { dot: dotBase + "bg-zinc-400", text: "Model ready to download" },
		downloading: { dot: dotBase + "bg-zinc-400 animate-pulse", text: "Downloading model…" },
		unavailable: { dot: dotBase + "bg-zinc-300 dark:bg-zinc-600", text: "Unavailable in this browser" },
	};
	const availability = agent.availability;
	const info = availability ? map[availability] : { dot: dotBase + "bg-zinc-400", text: "Checking model…" };
	dot.className = info.dot;
	label.textContent = info.text;
}

function updateEmptyStateNotice(): void {
	const notice = els.unavailableNotice();
	const empty = els.emptyState();
	if (!notice) return;
	const show = agent.availability === "unavailable";
	notice.classList.toggle("hidden", !show);
	empty.classList.toggle("hidden", show);
}

function showDownloadBanner(): void {
	els.downloadBanner().classList.remove("hidden");
	els.downloadBanner().classList.add("block");
}
function hideDownloadBanner(): void {
	els.downloadBanner().classList.add("hidden");
	els.downloadBanner().classList.remove("block");
}

function setDownloadProgress(fraction: number): void {
	const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
	els.downloadBar().style.setProperty("--w", `${pct}%`);
	els.downloadBar().style.width = `${pct}%`;
	els.downloadStatus().textContent = pct > 0 ? `${pct}% downloaded` : "Starting download…";
}

let compactHideTimer: ReturnType<typeof setTimeout> | null = null;
function showCompactStatus(msg: string, autoHideMs?: number): void {
	const banner = els.compactBanner();
	els.compactStatus().textContent = msg;
	banner.classList.remove("hidden");
	banner.classList.add("block");
	if (compactHideTimer) {
		clearTimeout(compactHideTimer);
		compactHideTimer = null;
	}
	if (autoHideMs) {
		compactHideTimer = setTimeout(() => {
			banner.classList.add("hidden");
			banner.classList.remove("block");
		}, autoHideMs);
	}
}
function hideCompactStatus(): void {
	els.compactBanner().classList.add("hidden");
	els.compactBanner().classList.remove("block");
}

function contextBarColor(ratio: number): string {
	if (ratio >= 0.9) return "bg-accent";
	if (ratio >= 0.7) return "bg-zinc-500 dark:bg-zinc-400";
	return "bg-zinc-400 dark:bg-zinc-500";
}

function updateContextPill(): void {
	const pill = els.contextPill();
	const text = els.contextText();
	const bar = els.contextBar();

	if (agent.compacting) {
		pill.classList.remove("hidden");
		pill.classList.add("flex");
		bar.style.width = "100%";
		bar.className = "block h-full rounded-full bg-accent animate-pulse transition-all duration-300";
		text.textContent = "Compacting";
		return;
	}

	const conv = store.current();
	const info = conv ? agent.contextInfo(conv.id) : null;
	if (info) {
		pill.classList.remove("hidden");
		pill.classList.add("flex");
		const ratio = Math.min(1, info.usage / info.window);
		bar.style.width = `${Math.round(ratio * 100)}%`;
		bar.className = `block h-full rounded-full ${contextBarColor(ratio)} transition-all duration-300`;
		text.textContent = `${Math.round(ratio * 100)}%`;
	} else {
		pill.classList.add("hidden");
		pill.classList.remove("flex");
	}
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function updateComposer(): void {
	const input = els.composerInput();
	const btn = els.sendBtn();
	const hasText = input.value.trim().length > 0;
	const blocked = agent.availability === "unavailable" || agent.compacting;

	// The stop affordance only belongs to the conversation that is actually
	// generating; in any other chat the composer must never abort it.
	if (state.isGenerating && state.generatingId === store.getCurrentId()) {
		btn.disabled = false;
		els.sendIcon().classList.add("hidden");
		els.stopIcon().classList.remove("hidden");
	} else {
		btn.disabled = blocked || state.isGenerating || !hasText;
		els.sendIcon().classList.remove("hidden");
		els.stopIcon().classList.add("hidden");
	}
}

function autoResize(): void {
	const ta = els.composerInput();
	ta.style.height = "auto";
	ta.style.height = `${Math.min(ta.scrollHeight, 192)}px`;
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

function scrollToBottom(force = false): void {
	const scroller = els.messagesScroll();
	if (force) {
		scroller.scrollTop = scroller.scrollHeight;
		return;
	}
	const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160;
	if (nearBottom) scroller.scrollTop = scroller.scrollHeight;
}

async function sendMessage(text: string): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed || state.isGenerating || agent.compacting) return;
	if (agent.availability === "unavailable") return;

	const conv = store.current() ?? store.create();

	// 1. Append the user message + an assistant placeholder and render IMMEDIATELY,
	// before any async work. Session creation (and possible model download) can
	// take a while on first use; the user must see their message right away.
	const userMsg: TChatMessage = { id: store.uid(), role: "user", content: trimmed };
	const assistantMsg: TChatMessage = { id: store.uid(), role: "assistant", content: "", streaming: true };
	conv.messages.push(userMsg, assistantMsg);
	const userCount = conv.messages.filter((m) => m.role === "user").length;
	if (userCount === 1) conv.title = truncate(trimmed);
	conv.updatedAt = Date.now();
	store.save();

	state.isGenerating = true;
	state.generatingId = conv.id;
	state.abort = new AbortController();
	updateComposer();
	renderAll();

	// Re-query per update: the list is re-rendered when the user switches
	// conversations, so a captured element could go stale mid-stream.
	const li = () =>
		els.messageList().querySelector<HTMLElement>(`[data-id="${assistantMsg.id}"]`) ?? undefined;
	let lastRender = 0;

	// Runs on the terminal event (done / aborted / error): persist, then refresh
	// the finished message in place (preserves scroll position) and the chrome.
	const finalize = () => {
		assistantMsg.streaming = false;
		state.isGenerating = false;
		state.generatingId = null;
		state.abort = null;
		store.save();

		const doneLi = li();
		if (doneLi) {
			if (!conv.messages.includes(assistantMsg)) {
				doneLi.remove();
			} else {
				const aw = doneLi.querySelector(".msg-actions");
				if (aw) aw.innerHTML = messageActionsHtml(assistantMsg, true);
				updateMessageContent(doneLi, assistantMsg);
			}
		}
		scrollToBottom();
		renderSidebar();
		renderHeader();
		updateComposer();
		updateContextPill();
	};

	// 2. Drive the agent loop. Terminal events always arrive with the agent's
	// session bookkeeping already settled, so the UI only mirrors them.
	for await (const event of agent.run(conv, trimmed, state.abort.signal)) {
		switch (event.type) {
			case "chunk": {
				assistantMsg.content = event.content;
				const now = performance.now();
				if (now - lastRender > 40) {
					lastRender = now;
					const el = li();
					if (el) updateMessageContent(el, assistantMsg);
					scrollToBottom();
				}
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
	updateComposer();
}

async function regenerate(): Promise<void> {
	const conv = store.current();
	if (!conv || state.isGenerating) return;
	// Drop the last user/assistant exchange.
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
	// Force a fresh session built from the trimmed history.
	agent.destroySession(conv.id);
	store.save();
	renderMessages();
	await sendMessage(text);
}

function abortCurrent(): void {
	state.abort?.abort();
}

// ---------------------------------------------------------------------------
// Sidebar drawer
// ---------------------------------------------------------------------------

function openSidebar(): void {
	els.sidebar().dataset.open = "";
	els.backdrop().classList.remove("hidden");
}
function closeSidebar(): void {
	delete els.sidebar().dataset.open;
	els.backdrop().classList.add("hidden");
}

// Desktop collapse (Cmd/Ctrl+B). On lg+ screens the sidebar animates its
// width to zero instead of acting as a mobile drawer.
function isDesktop(): boolean {
	return window.matchMedia("(min-width: 1024px)").matches;
}
function sidebarCollapsed(): boolean {
	return els.sidebar().dataset.collapsed !== undefined;
}
function setSidebarCollapsed(collapsed: boolean): void {
	if (collapsed) els.sidebar().dataset.collapsed = "";
	else delete els.sidebar().dataset.collapsed;
	try {
		localStorage.setItem(STORAGE_SIDEBAR, collapsed ? "1" : "0");
	} catch {
		/* ignore */
	}
}
function toggleSidebar(): void {
	if (isDesktop()) {
		setSidebarCollapsed(!sidebarCollapsed());
	} else if (els.sidebar().dataset.open !== undefined) {
		closeSidebar();
	} else {
		openSidebar();
	}
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function openSettings(): void {
	syncSettingsFields();
	els.settingsDialog().showModal();
}
function closeSettings(): void {
	els.settingsDialog().close();
}

function syncSettingsFields(): void {
	els.settingSystem().value = state.settings.systemPrompt;
	const params = agent.modelParams;
	if (params) {
		els.paramControls().classList.remove("hidden");
		els.paramControls().classList.add("flex");
		const t = els.settingTemperature();
		t.min = "0";
		t.max = String(params.maxTemperature);
		t.step = "0.1";
		t.value = String(state.settings.temperature);
		els.temperatureValue().textContent = state.settings.temperature.toFixed(1);
		const k = els.settingTopk();
		k.min = "1";
		k.max = String(params.maxTopK);
		k.step = "1";
		k.value = String(state.settings.topK);
		els.topkValue().textContent = String(state.settings.topK);
	}
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireEvents(): void {
	// New chat
	els.newChatBtn().addEventListener("click", () => {
		store.startNew();
		hideCompactStatus();
		renderAll();
		closeSidebar();
		els.composerInput().focus();
		updateComposer();
	});

	// Conversation list (switch + delete) via delegation
	els.conversationList().addEventListener("click", (e) => {
		const li = (e.target as HTMLElement).closest("li");
		if (!li) return;
		const id = li.dataset.id;
		if (!id) return;
		const delBtn = (e.target as HTMLElement).closest("button[aria-label='Delete conversation']");
		if (delBtn) {
			deleteConversation(id);
			renderAll();
			return;
		}
		store.setCurrent(id);
		hideCompactStatus();
		renderAll();
		closeSidebar();
	});

	// Sidebar drawer (mobile) + collapse (desktop)
	els.menuBtn().addEventListener("click", toggleSidebar);
	els.sidebarClose().addEventListener("click", closeSidebar);
	els.backdrop().addEventListener("click", closeSidebar);

	// Composer
	els.composerInput().addEventListener("input", () => {
		autoResize();
		updateComposer();
	});
	els.composerInput().addEventListener("keydown", (e) => {
		if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			if (!state.isGenerating && !agent.compacting) els.composerForm().requestSubmit();
		}
	});
	els.composerForm().addEventListener("submit", (e) => {
		e.preventDefault();
		if (state.isGenerating) {
			// Stop only applies to the conversation that is generating.
			if (state.generatingId === store.getCurrentId()) abortCurrent();
			return;
		}
		if (agent.compacting) return;
		const text = els.composerInput().value;
		if (!text.trim()) return;
		els.composerInput().value = "";
		autoResize();
		void sendMessage(text);
	});

	// Suggestion cards
	els.emptyState().addEventListener("click", (e) => {
		const card = (e.target as HTMLElement).closest(".suggestion-card") as HTMLElement | null;
		if (card?.dataset.prompt) void sendMessage(card.dataset.prompt);
	});

	// Message actions (copy + regenerate) via delegation
	els.messageList().addEventListener("click", (e) => {
		const target = e.target as HTMLElement;
		const copyBtn = target.closest(".msg-copy") as HTMLElement | null;
		if (copyBtn) {
			const li = copyBtn.closest("li");
			const msg = store.current()?.messages.find((m) => m.id === li?.dataset.id);
			if (msg) void copyMessage(msg.content, copyBtn);
			return;
		}
		const regenBtn = target.closest(".msg-regen") as HTMLElement | null;
		if (regenBtn) void regenerate();
	});

	// Settings
	els.settingsBtn().addEventListener("click", openSettings);
	els.settingsClose().addEventListener("click", closeSettings);
	els.settingsDialog().addEventListener("click", (e) => {
		if (e.target === els.settingsDialog()) closeSettings();
	});
	els.settingSystem().addEventListener("input", () => {
		state.settings.systemPrompt = els.settingSystem().value;
		store.saveSettings(state.settings);
		agent.invalidateSessions();
	});
	els.settingTemperature().addEventListener("input", () => {
		state.settings.temperature = parseFloat(els.settingTemperature().value);
		els.temperatureValue().textContent = state.settings.temperature.toFixed(1);
		store.saveSettings(state.settings);
		agent.invalidateSessions();
	});
	els.settingTopk().addEventListener("input", () => {
		state.settings.topK = parseInt(els.settingTopk().value, 10);
		els.topkValue().textContent = String(state.settings.topK);
		store.saveSettings(state.settings);
		agent.invalidateSessions();
	});
	els.clearAllBtn().addEventListener("click", () => {
		for (const c of [...store.list()]) deleteConversation(c.id);
		agent.destroySummarizers();
		store.startNew();
		store.save();
		renderAll();
		closeSettings();
	});

	// Keyboard: Cmd/Ctrl+B toggles the sidebar, Esc closes the mobile drawer
	document.addEventListener("keydown", (e) => {
		if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "b") {
			e.preventDefault();
			toggleSidebar();
			return;
		}
		if (e.key === "Escape" && els.sidebar().dataset.open !== undefined) closeSidebar();
	});
}

async function copyMessage(text: string, btn: HTMLElement): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		btn.querySelector(".copy-idle")?.classList.add("hidden");
		btn.querySelector(".copy-done")?.classList.remove("hidden");
		btn.querySelector(".copy-done")?.classList.add("flex");
		setTimeout(() => {
			btn.querySelector(".copy-idle")?.classList.remove("hidden");
			btn.querySelector(".copy-done")?.classList.add("hidden");
			btn.querySelector(".copy-done")?.classList.remove("flex");
		}, 1600);
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

export function startApp(): void {
	store.load();
	// Always open on a fresh chat — past conversations stay in the sidebar but
	// are never silently resumed. Landing in an old chat meant the next message
	// continued that old session, which is exactly the surprise we're avoiding.
	store.startNew();

	// Restore the desktop sidebar collapse preference before first paint.
	try {
		if (localStorage.getItem(STORAGE_SIDEBAR) === "1") setSidebarCollapsed(true);
	} catch {
		/* ignore */
	}

	syncSettingsFields();
	wireEvents();
	renderAll();
	autoResize();
	updateComposer();

	void (async () => {
		await agent.boot();
		syncSettingsFields();
	})();
}
