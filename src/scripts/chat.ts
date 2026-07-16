import { marked } from "marked";
import { icon } from "../lib/icons";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	streaming?: boolean;
	error?: boolean;
}

interface Conversation {
	id: string;
	title: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
}

interface Settings {
	systemPrompt: string;
	temperature: number;
	topK: number;
}

type Availability = "unavailable" | "downloadable" | "downloading" | "available";

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const STORAGE_CONVOS = "oda.conversations.v1";
const STORAGE_SETTINGS = "oda.settings.v1";

const DEFAULT_SYSTEM =
	"You are a helpful, friendly assistant running entirely on the user's device. Keep responses concise and clear. Use Markdown when it helps readability.";

const state = {
	conversations: [] as Conversation[],
	currentId: null as string | null,
	settings: loadSettings(),
	availability: null as Availability | null,
	isGenerating: false,
	abort: null as AbortController | null,
	paramSupport: false,
	params: null as { defaultTemperature: number; maxTemperature: number; defaultTopK: number; maxTopK: number } | null,
};

const sessions = new Map<string, LanguageModel>();
// Each live session holds memory and keeps the model loaded. Cap concurrent
// sessions; least-recently-used idle ones are destroyed and can be rebuilt
// from stored history on demand (the "restore past session" pattern).
const MAX_SESSIONS = 3;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function uid(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadSettings(): Settings {
	try {
		const raw = localStorage.getItem(STORAGE_SETTINGS);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Settings>;
			return {
				systemPrompt: typeof parsed.systemPrompt === "string" ? parsed.systemPrompt : DEFAULT_SYSTEM,
				temperature: typeof parsed.temperature === "number" ? parsed.temperature : 1,
				topK: typeof parsed.topK === "number" ? parsed.topK : 3,
			};
		}
	} catch {
		/* ignore */
	}
	return { systemPrompt: DEFAULT_SYSTEM, temperature: 1, topK: 3 };
}

function saveSettings(): void {
	try {
		localStorage.setItem(STORAGE_SETTINGS, JSON.stringify(state.settings));
	} catch {
		/* ignore */
	}
}

function loadConversations(): Conversation[] {
	try {
		const raw = localStorage.getItem(STORAGE_CONVOS);
		if (raw) return JSON.parse(raw) as Conversation[];
	} catch {
		/* ignore */
	}
	return [];
}

function saveConversations(): void {
	try {
		localStorage.setItem(STORAGE_CONVOS, JSON.stringify(state.conversations));
	} catch {
		/* ignore */
	}
}

// ---------------------------------------------------------------------------
// Conversation helpers
// ---------------------------------------------------------------------------

function currentConversation(): Conversation | null {
	return state.conversations.find((c) => c.id === state.currentId) ?? null;
}

function createConversation(): Conversation {
	const conv: Conversation = {
		id: uid(),
		title: "New chat",
		messages: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	state.conversations.unshift(conv);
	state.currentId = conv.id;
	saveConversations();
	return conv;
}

function deleteConversation(id: string): void {
	const idx = state.conversations.findIndex((c) => c.id === id);
	if (idx === -1) return;
	state.conversations.splice(idx, 1);
	destroySession(id);
	if (state.currentId === id) {
		state.currentId = state.conversations[0]?.id ?? null;
		if (!state.currentId) createConversation();
	}
	saveConversations();
}

function destroySession(id: string): void {
	const session = sessions.get(id);
	if (!session) return;
	sessions.delete(id);
	try {
		session.destroy();
	} catch {
		/* ignore */
	}
}

// Mark a session as most-recently-used (Map preserves insertion order, so
// delete + re-set moves it to the end).
function touchSession(id: string): void {
	const session = sessions.get(id);
	if (!session) return;
	sessions.delete(id);
	sessions.set(id, session);
}

// Evict least-recently-used idle sessions when we exceed the cap. Safe to call
// during sendMessage: generation is never in-flight here (sendMessage is gated
// on !state.isGenerating), so every session in the map is idle.
function evictIdleSessions(): void {
	while (sessions.size > MAX_SESSIONS) {
		const oldestId = sessions.keys().next().value;
		if (!oldestId) break;
		destroySession(oldestId);
	}
}

function invalidateSessions(): void {
	for (const id of [...sessions.keys()]) destroySession(id);
	updateContextPill();
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
// Model / sessions
// ---------------------------------------------------------------------------

function buildInitialPrompts(
	conv: Conversation,
	excludeLastN = 0,
): { role: "system" | "user" | "assistant"; content: string }[] {
	const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [];
	const sys = state.settings.systemPrompt.trim();
	if (sys) msgs.push({ role: "system", content: sys });
	const end = Math.max(0, conv.messages.length - excludeLastN);
	for (let i = 0; i < end; i++) msgs.push({ role: conv.messages[i].role, content: conv.messages[i].content });
	return msgs;
}

async function ensureSession(conv: Conversation, excludeLastN = 0): Promise<LanguageModel> {
	const existing = sessions.get(conv.id);
	if (existing) {
		touchSession(conv.id);
		return existing;
	}

	const initialPrompts = buildInitialPrompts(conv, excludeLastN);
	const options: Record<string, unknown> = {
		initialPrompts,
		monitor: (m: CreateMonitor) => {
			m.addEventListener("downloadprogress", (e: ProgressEvent) => {
				const loaded = typeof e.loaded === "number" ? e.loaded : 0;
				setDownloadProgress(loaded);
			});
		},
	};
	if (state.paramSupport && state.params) {
		options.temperature = state.settings.temperature;
		options.topK = state.settings.topK;
	}

	const needsDownload = state.availability === "downloadable" || state.availability === "downloading";
	if (needsDownload) {
		state.availability = "downloading";
		updateModelStatus();
		showDownloadBanner();
	}

	try {
		const session = await LanguageModel.create(options as LanguageModelCreateOptions);
		sessions.set(conv.id, session);
		session.oncontextoverflow = () => updateContextPill();
		if (state.availability !== "available") {
			state.availability = "available";
			updateModelStatus();
		}
		hideDownloadBanner();
		evictIdleSessions();
		updateContextPill();
		return session;
	} catch (err) {
		hideDownloadBanner();
		throw err;
	}
}

async function refreshAvailability(): Promise<void> {
	let avail: Availability;
	try {
		avail = await LanguageModel.availability();
	} catch {
		avail = "unavailable";
	}
	state.availability = avail;
	updateModelStatus();
	updateComposer();
	updateEmptyStateNotice();
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
	contextText: () => $("#context-text") as HTMLElement,

	emptyState: () => $("#empty-state") as HTMLElement,
	messageList: () => $("#message-list") as HTMLOListElement,
	messagesScroll: () => $("#messages-scroll") as HTMLElement,
	downloadBanner: () => $("#download-banner") as HTMLElement,
	downloadBar: () => $("#download-bar") as HTMLElement,
	downloadStatus: () => $("#download-status") as HTMLElement,
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
	const convos = state.conversations;
	els.noConvos().classList.toggle("hidden", convos.length > 0);

	list.replaceChildren(
		...convos.map((conv) => {
			const li = document.createElement("li");
			li.className = "group relative";
			li.dataset.id = conv.id;

			const active = conv.id === state.currentId;
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
				"absolute top-1/2 right-1.5 -translate-y-1/2 flex size-7 items-center justify-center rounded-md text-zinc-400 opacity-0 transition-opacity hover:bg-zinc-950/10 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10 dark:hover:text-red-400";
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
	const conv = currentConversation();
	els.chatTitle().textContent = conv?.title || "New chat";
}

function messageActionsHtml(msg: ChatMessage, isLast: boolean): string {
	let html = `<div class="mt-2 flex items-center gap-1">`;
	html += `<button type="button" class="msg-copy relative flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-200">
		<span class="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-x-1/2 -translate-y-1/2" aria-hidden="true"></span>
		<span class="copy-idle flex items-center gap-1.5">${icon("clipboard")}Copy</span>
		<span class="copy-done hidden items-center gap-1.5 text-emerald-600 dark:text-emerald-400">${icon("check")}Copied</span>
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

function createMessageEl(msg: ChatMessage, isLast: boolean): HTMLLIElement {
	const li = document.createElement("li");
	li.className = "msg-row";
	li.dataset.id = msg.id;
	li.setAttribute("role", "listitem");

	if (msg.role === "user") {
		li.className = "flex justify-end";
		const bubble = document.createElement("div");
		bubble.className =
			"max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-emerald-600 px-4 py-2.5 text-base text-white shadow-sm dark:shadow-none";
		bubble.textContent = msg.content;
		li.append(bubble);
	} else {
		li.className = "flex gap-3";
		const avatar = document.createElement("div");
		avatar.className = "mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400";
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

function updateMessageContent(li: HTMLElement, msg: ChatMessage): void {
	const content = li.querySelector(".msg-content");
	if (!content) return;

	if (msg.error) {
		content.className =
			"msg-content flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300";
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
	const conv = currentConversation();
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
	const map: Record<Availability, { dot: string; text: string }> = {
		available: { dot: dotBase + "bg-emerald-500", text: "Ready · Gemini Nano" },
		downloadable: { dot: dotBase + "bg-amber-500", text: "Model ready to download" },
		downloading: { dot: dotBase + "bg-amber-500 animate-pulse", text: "Downloading model…" },
		unavailable: { dot: dotBase + "bg-red-500", text: "Unavailable in this browser" },
	};
	const info = state.availability ? map[state.availability] : { dot: dotBase + "bg-zinc-400", text: "Checking model…" };
	dot.className = info.dot;
	label.textContent = info.text;
}

function updateEmptyStateNotice(): void {
	const notice = els.unavailableNotice();
	const empty = els.emptyState();
	if (!notice) return;
	const show = state.availability === "unavailable";
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

function updateContextPill(): void {
	const pill = els.contextPill();
	const text = els.contextText();
	const conv = currentConversation();
	const session = conv ? sessions.get(conv.id) : undefined;
	if (session && typeof session.contextWindow === "number") {
		pill.classList.remove("hidden");
		pill.classList.add("flex");
		text.textContent = `${fmtTokens(session.contextUsage)} / ${fmtTokens(session.contextWindow)} ctx`;
	} else {
		pill.classList.add("hidden");
		pill.classList.remove("flex");
	}
}

function fmtTokens(n: number): string {
	if (n >= 10000) return `${Math.round(n / 1000)}k`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(Math.round(n));
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function updateComposer(): void {
	const input = els.composerInput();
	const btn = els.sendBtn();
	const hasText = input.value.trim().length > 0;
	const blocked = state.availability === "unavailable";

	if (state.isGenerating) {
		btn.disabled = false;
		els.sendIcon().classList.add("hidden");
		els.stopIcon().classList.remove("hidden");
	} else {
		btn.disabled = blocked || !hasText;
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
	if (!trimmed || state.isGenerating) return;
	if (state.availability === "unavailable") return;

	let conv = currentConversation();
	if (!conv) conv = createConversation();

	// 1. Append the user message + an assistant placeholder and render IMMEDIATELY,
	// before any async work. Session creation (and possible model download) can
	// take a while on first use; the user must see their message right away.
	const userMsg: ChatMessage = { id: uid(), role: "user", content: trimmed };
	const assistantMsg: ChatMessage = { id: uid(), role: "assistant", content: "", streaming: true };
	conv.messages.push(userMsg, assistantMsg);
	const userCount = conv.messages.filter((m) => m.role === "user").length;
	if (userCount === 1) conv.title = truncate(trimmed);
	conv.updatedAt = Date.now();
	saveConversations();

	state.isGenerating = true;
	state.abort = new AbortController();
	updateComposer();
	renderAll();

	// 2. Ensure a session built from history BEFORE this exchange (exclude the
	// two messages we just pushed so the new prompt isn't double-counted).
	let session: LanguageModel;
	try {
		session = await ensureSession(conv, 2);
	} catch (err) {
		handleSessionError(conv, assistantMsg, err);
		state.isGenerating = false;
		state.abort = null;
		saveConversations();
		renderAll();
		updateComposer();
		return;
	}

	// 3. Stream the response.
	const li = els.messageList().querySelector<HTMLElement>(`[data-id="${assistantMsg.id}"]`);
	await streamResponse(session, trimmed, assistantMsg, li ?? undefined);

	assistantMsg.streaming = false;
	state.isGenerating = false;
	state.abort = null;
	saveConversations();

	// Refresh the finished assistant message so its Regenerate action appears,
	// without rebuilding the whole list (preserves scroll position).
	const doneLi = els.messageList().querySelector<HTMLElement>(`[data-id="${assistantMsg.id}"]`);
	if (doneLi) {
		const aw = doneLi.querySelector(".msg-actions");
		if (aw) aw.innerHTML = messageActionsHtml(assistantMsg, true);
		updateMessageContent(doneLi, assistantMsg);
	}

	renderSidebar();
	renderHeader();
	updateComposer();
	updateContextPill();
}

async function streamResponse(
	session: LanguageModel,
	prompt: string,
	assistantMsg: ChatMessage,
	li?: HTMLElement,
): Promise<void> {
	try {
		const stream = session.promptStreaming(prompt, { signal: state.abort?.signal });
		let acc = "";
		let lastRender = 0;
		const reader = stream.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (value) {
				// Robust to both delta-style and cumulative-style streams.
				acc = acc === "" || value.startsWith(acc) ? value : acc + value;
				assistantMsg.content = acc;
				const now = performance.now();
				if (now - lastRender > 40) {
					lastRender = now;
					if (li) updateMessageContent(li, assistantMsg);
					scrollToBottom();
				}
			}
		}
		if (li) updateMessageContent(li, assistantMsg);
		scrollToBottom();
	} catch (err) {
		const e = err as DOMException;
		if (e?.name === "AbortError") {
			// Keep whatever was streamed so far; mark done.
			return;
		}
		assistantMsg.error = true;
		assistantMsg.content = friendlyError(e);
		if (li) updateMessageContent(li, assistantMsg);
	}
}

function friendlyError(e: unknown): string {
	const err = e as DOMException;
	if (err?.name === "QuotaExceededError") {
		return "The conversation exceeded the model's context window. Try starting a new chat.";
	}
	if (err?.name === "NotSupportedError") {
		return "The model couldn't handle this request. Try rephrasing or starting a new chat.";
	}
	return err?.message || "Something went wrong while generating a response.";
}

function handleSessionError(conv: Conversation, placeholder: ChatMessage, err: unknown): void {
	hideDownloadBanner();
	const e = err as DOMException;

	// On abort, drop the empty placeholder but keep the user message so they can retry.
	if (e?.name === "AbortError") {
		placeholder.streaming = false;
		const idx = conv.messages.indexOf(placeholder);
		if (idx !== -1 && !placeholder.content) conv.messages.splice(idx, 1);
		conv.updatedAt = Date.now();
		return;
	}

	// Convert the placeholder into an error bubble.
	placeholder.streaming = false;
	placeholder.error = true;
	placeholder.content =
		e?.name === "NotSupportedError"
			? "The on-device model isn't available in this browser. Use a recent Chrome version on a supported device."
			: friendlyError(e);
	conv.updatedAt = Date.now();
}

async function regenerate(): Promise<void> {
	const conv = currentConversation();
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
	// Force a fresh session built from the trimmed history.
	destroySession(conv.id);
	saveConversations();
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
	if (state.paramSupport && state.params) {
		els.paramControls().classList.remove("hidden");
		els.paramControls().classList.add("flex");
		const t = els.settingTemperature();
		t.min = "0";
		t.max = String(state.params.maxTemperature);
		t.step = "0.1";
		t.value = String(state.settings.temperature);
		els.temperatureValue().textContent = state.settings.temperature.toFixed(1);
		const k = els.settingTopk();
		k.min = "1";
		k.max = String(state.params.maxTopK);
		k.step = "1";
		k.value = String(state.settings.topK);
		els.topkValue().textContent = String(state.settings.topK);
	}
}

async function detectParamSupport(): Promise<void> {
	// params() is restricted to extension / origin-trial contexts.
	try {
		if (typeof LanguageModel.params === "function") {
			const p = await LanguageModel.params();
			if (p && typeof p.defaultTemperature === "number") {
				state.paramSupport = true;
				state.params = {
					defaultTemperature: p.defaultTemperature,
					maxTemperature: p.maxTemperature ?? 2,
					defaultTopK: p.defaultTopK ?? 3,
					maxTopK: p.maxTopK ?? 128,
				};
			}
		}
	} catch {
		state.paramSupport = false;
	}
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------

function wireEvents(): void {
	// New chat
	els.newChatBtn().addEventListener("click", () => {
		createConversation();
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
		state.currentId = id;
		renderAll();
		closeSidebar();
	});

	// Mobile drawer
	els.menuBtn().addEventListener("click", openSidebar);
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
			if (!state.isGenerating) els.composerForm().requestSubmit();
		}
	});
	els.composerForm().addEventListener("submit", (e) => {
		e.preventDefault();
		if (state.isGenerating) {
			abortCurrent();
			return;
		}
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
			const msg = currentConversation()?.messages.find((m) => m.id === li?.dataset.id);
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
		saveSettings();
		invalidateSessions();
	});
	els.settingTemperature().addEventListener("input", () => {
		state.settings.temperature = parseFloat(els.settingTemperature().value);
		els.temperatureValue().textContent = state.settings.temperature.toFixed(1);
		saveSettings();
		invalidateSessions();
	});
	els.settingTopk().addEventListener("input", () => {
		state.settings.topK = parseInt(els.settingTopk().value, 10);
		els.topkValue().textContent = String(state.settings.topK);
		saveSettings();
		invalidateSessions();
	});
	els.clearAllBtn().addEventListener("click", () => {
		for (const c of [...state.conversations]) deleteConversation(c.id);
		createConversation();
		saveConversations();
		renderAll();
		closeSettings();
	});

	// Keyboard: Esc closes drawer when open
	document.addEventListener("keydown", (e) => {
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
	state.conversations = loadConversations();
	if (state.conversations.length === 0) {
		createConversation();
	} else {
		state.currentId = state.conversations[0].id;
	}

	syncSettingsFields();
	wireEvents();
	renderAll();
	autoResize();
	updateComposer();

	void (async () => {
		await detectParamSupport();
		syncSettingsFields();
		await refreshAvailability();
	})();
}
