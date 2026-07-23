export type TSpeechLanguage = {
	code: string;
	label: string;
	englishLabel: string;
};

// BCP-47 tags; native + English labels so the search box matches either.
export const SPEECH_LANGUAGES: TSpeechLanguage[] = [
	{ code: "af-ZA", label: "Afrikaans", englishLabel: "Afrikaans" },
	{ code: "am-ET", label: "አማርኛ", englishLabel: "Amharic" },
	{ code: "ar-SA", label: "العربية", englishLabel: "Arabic" },
	{ code: "az-AZ", label: "Azərbaycanca", englishLabel: "Azerbaijani" },
	{ code: "bg-BG", label: "Български", englishLabel: "Bulgarian" },
	{ code: "bn-IN", label: "বাংলা", englishLabel: "Bengali" },
	{ code: "ca-ES", label: "Català", englishLabel: "Catalan" },
	{ code: "cs-CZ", label: "Čeština", englishLabel: "Czech" },
	{ code: "da-DK", label: "Dansk", englishLabel: "Danish" },
	{ code: "de-DE", label: "Deutsch", englishLabel: "German" },
	{ code: "el-GR", label: "Ελληνικά", englishLabel: "Greek" },
	{ code: "en-US", label: "English (US)", englishLabel: "English (US)" },
	{ code: "en-GB", label: "English (UK)", englishLabel: "English (UK)" },
	{ code: "en-AU", label: "English (Australia)", englishLabel: "English (Australia)" },
	{ code: "en-CA", label: "English (Canada)", englishLabel: "English (Canada)" },
	{ code: "en-IN", label: "English (India)", englishLabel: "English (India)" },
	{ code: "es-ES", label: "Español (España)", englishLabel: "Spanish (Spain)" },
	{ code: "es-MX", label: "Español (México)", englishLabel: "Spanish (Mexico)" },
	{ code: "es-US", label: "Español (US)", englishLabel: "Spanish (US)" },
	{ code: "et-EE", label: "Eesti", englishLabel: "Estonian" },
	{ code: "eu-ES", label: "Euskara", englishLabel: "Basque" },
	{ code: "fa-IR", label: "فارسی", englishLabel: "Persian" },
	{ code: "fi-FI", label: "Suomi", englishLabel: "Finnish" },
	{ code: "fil-PH", label: "Filipino", englishLabel: "Filipino" },
	{ code: "fr-FR", label: "Français", englishLabel: "French" },
	{ code: "fr-CA", label: "Français (Canada)", englishLabel: "French (Canada)" },
	{ code: "gl-ES", label: "Galego", englishLabel: "Galician" },
	{ code: "gu-IN", label: "ગુજરાતી", englishLabel: "Gujarati" },
	{ code: "he-IL", label: "עברית", englishLabel: "Hebrew" },
	{ code: "hi-IN", label: "हिन्दी", englishLabel: "Hindi" },
	{ code: "hr-HR", label: "Hrvatski", englishLabel: "Croatian" },
	{ code: "hu-HU", label: "Magyar", englishLabel: "Hungarian" },
	{ code: "hy-AM", label: "Հայերեն", englishLabel: "Armenian" },
	{ code: "id-ID", label: "Bahasa Indonesia", englishLabel: "Indonesian" },
	{ code: "is-IS", label: "Íslenska", englishLabel: "Icelandic" },
	{ code: "it-IT", label: "Italiano", englishLabel: "Italian" },
	{ code: "ja-JP", label: "日本語", englishLabel: "Japanese" },
	{ code: "jv-ID", label: "Basa Jawa", englishLabel: "Javanese" },
	{ code: "ka-GE", label: "ქართული", englishLabel: "Georgian" },
	{ code: "km-KH", label: "ភាសាខ្មែរ", englishLabel: "Khmer" },
	{ code: "kn-IN", label: "ಕನ್ನಡ", englishLabel: "Kannada" },
	{ code: "ko-KR", label: "한국어", englishLabel: "Korean" },
	{ code: "lo-LA", label: "ລາວ", englishLabel: "Lao" },
	{ code: "lt-LT", label: "Lietuvių", englishLabel: "Lithuanian" },
	{ code: "lv-LV", label: "Latviešu", englishLabel: "Latvian" },
	{ code: "ml-IN", label: "മലയാളം", englishLabel: "Malayalam" },
	{ code: "mr-IN", label: "मराठी", englishLabel: "Marathi" },
	{ code: "ms-MY", label: "Bahasa Melayu", englishLabel: "Malay" },
	{ code: "nb-NO", label: "Norsk bokmål", englishLabel: "Norwegian" },
	{ code: "ne-NP", label: "नेपाली", englishLabel: "Nepali" },
	{ code: "nl-NL", label: "Nederlands", englishLabel: "Dutch" },
	{ code: "pl-PL", label: "Polski", englishLabel: "Polish" },
	{ code: "pt-BR", label: "Português (Brasil)", englishLabel: "Portuguese (Brazil)" },
	{ code: "pt-PT", label: "Português (Portugal)", englishLabel: "Portuguese (Portugal)" },
	{ code: "ro-RO", label: "Română", englishLabel: "Romanian" },
	{ code: "ru-RU", label: "Русский", englishLabel: "Russian" },
	{ code: "si-LK", label: "සිංහල", englishLabel: "Sinhala" },
	{ code: "sk-SK", label: "Slovenčina", englishLabel: "Slovak" },
	{ code: "sl-SI", label: "Slovenščina", englishLabel: "Slovenian" },
	{ code: "sr-RS", label: "Српски", englishLabel: "Serbian" },
	{ code: "su-ID", label: "Basa Sunda", englishLabel: "Sundanese" },
	{ code: "sv-SE", label: "Svenska", englishLabel: "Swedish" },
	{ code: "sw-KE", label: "Kiswahili", englishLabel: "Swahili" },
	{ code: "ta-IN", label: "தமிழ்", englishLabel: "Tamil" },
	{ code: "te-IN", label: "తెలుగు", englishLabel: "Telugu" },
	{ code: "th-TH", label: "ภาษาไทย", englishLabel: "Thai" },
	{ code: "tr-TR", label: "Türkçe", englishLabel: "Turkish" },
	{ code: "uk-UA", label: "Українська", englishLabel: "Ukrainian" },
	{ code: "ur-PK", label: "اردو", englishLabel: "Urdu" },
	{ code: "vi-VN", label: "Tiếng Việt", englishLabel: "Vietnamese" },
	{ code: "zh-CN", label: "中文 (简体)", englishLabel: "Chinese (Simplified)" },
	{ code: "zh-TW", label: "中文 (繁體)", englishLabel: "Chinese (Traditional)" },
	{ code: "zh-HK", label: "粵語 (香港)", englishLabel: "Cantonese (Hong Kong)" },
	{ code: "zu-ZA", label: "IsiZulu", englishLabel: "Zulu" },
];

const STORAGE_KEY = "oda-dictation-language";

const matchSpeechLanguage = (tag: string): string | null => {
	const exact = SPEECH_LANGUAGES.find(
		(language) => language.code.toLowerCase() === tag.toLowerCase(),
	);
	if (exact) return exact.code;

	const primary = tag.split("-")[0]?.toLowerCase();
	if (!primary) return null;
	const prefix = SPEECH_LANGUAGES.find(
		(language) => language.code.toLowerCase().split("-")[0] === primary,
	);
	return prefix?.code ?? null;
};

export const getDictationLanguage = (): string => {
	if (typeof window === "undefined") return "en-US";

	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (stored) {
		const matched = matchSpeechLanguage(stored);
		if (matched) return matched;
	}

	return matchSpeechLanguage(navigator.language) ?? "en-US";
};

export const setDictationLanguage = (code: string): void => {
	if (typeof window === "undefined") return;
	window.localStorage.setItem(STORAGE_KEY, code);
};
