// Pure logic for the Structured Output Playground: presets and a minimal JSON
// Schema validator (enough for the playground's schemas). No DOM access.

export type TPreset = {
	id: string;
	label: string;
	instruction: string;
	input: string;
	schema: Record<string, unknown>;
};

export const PRESETS: TPreset[] = [
	{
		id: "pottery",
		label: "Boolean",
		instruction:
			"Is the following social media post about pottery? Reply strictly according to the response schema.",
		input:
			"Mugs and ramen bowls, both a bit smaller than intended, but that's how it goes with reclaim. Glaze crawled the first time around, but pretty happy with it after refiring.",
		schema: { type: "boolean" },
	},
	{
		id: "hashtags",
		label: "Array + pattern",
		instruction: "Suggest at most three hashtags for the following social media post.",
		input:
			"Spent the weekend finally fixing the dripping kitchen faucet. New cartridge in, no more percussion solo at 3am. Small wins matter.",
		schema: {
			type: "object",
			properties: {
				hashtags: {
					type: "array",
					maxItems: 3,
					items: { type: "string", pattern: "^#[^\\s#]+$" },
				},
			},
			required: ["hashtags"],
			additionalProperties: false,
		},
	},
	{
		id: "sentiment",
		label: "Enum",
		instruction: "Classify the overall sentiment of the following review.",
		input:
			"The headphones sound great and the battery lasts forever, but the ear cushions started peeling after a month. I'd still recommend them on sale.",
		schema: { type: "string", enum: ["positive", "negative", "neutral", "mixed"] },
	},
	{
		id: "review",
		label: "Object",
		instruction: "Extract structured details from the following product review.",
		input:
			"I've had this coffee grinder for about six weeks. It's surprisingly quiet and grinds evenly, though the hopper is small so I refill it daily. Cleanup is easy. Overall I'd buy it again.",
		schema: {
			type: "object",
			properties: {
				rating: { type: "integer", minimum: 1, maximum: 5 },
				summary: { type: "string", maxLength: 120 },
				pros: { type: "array", items: { type: "string" }, maxItems: 5 },
				cons: { type: "array", items: { type: "string" }, maxItems: 5 },
				recommends: { type: "boolean" },
			},
			required: ["rating", "summary", "pros", "cons", "recommends"],
			additionalProperties: false,
		},
	},
	{
		id: "palette",
		label: "Nested",
		instruction: "Design a small color palette that matches the mood described below.",
		input: "A calm, rainy autumn afternoon spent reading by the window with a cup of tea.",
		schema: {
			type: "object",
			properties: {
				name: { type: "string", maxLength: 40 },
				mood: { type: "string", enum: ["calm", "energetic", "cozy", "mysterious", "playful"] },
				colors: {
					type: "array",
					minItems: 3,
					maxItems: 5,
					items: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
				},
			},
			required: ["name", "mood", "colors"],
			additionalProperties: false,
		},
	},
];

export type TIssue = {
	path: string;
	msg: string;
};

function realType(v: unknown): string {
	if (v === null) return "null";
	if (Array.isArray(v)) return "array";
	return typeof v;
}

function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
	}
	if (a && b && typeof a === "object") {
		const ka = Object.keys(a as Record<string, unknown>);
		const kb = Object.keys(b as Record<string, unknown>);
		return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}

function typeMatches(value: unknown, type: string): boolean {
	switch (type) {
		case "object":
			return typeof value === "object" && value !== null && !Array.isArray(value);
		case "array":
			return Array.isArray(value);
		case "string":
			return typeof value === "string";
		case "integer":
			return typeof value === "number" && Number.isInteger(value);
		case "number":
			return typeof value === "number";
		case "boolean":
			return typeof value === "boolean";
		case "null":
			return value === null;
		default:
			return true;
	}
}

export function validate(schema: Record<string, unknown>, value: unknown): TIssue[] {
	const issues: TIssue[] = [];
	walk(schema, value, "$", issues);
	return issues;
}

function walk(schema: Record<string, unknown>, value: unknown, path: string, issues: TIssue[]): void {
	if (typeof schema !== "object" || schema === null) return;

	if (Array.isArray(schema.enum)) {
		if (!schema.enum.some((e) => deepEqual(e, value))) {
			issues.push({ path, msg: `must be one of ${JSON.stringify(schema.enum)}` });
		}
	}

	const type = typeof schema.type === "string" ? (schema.type as string) : undefined;
	if (type && !typeMatches(value, type)) {
		issues.push({ path, msg: `expected ${type}, got ${realType(value)}` });
		return;
	}

	if (type === "object" && value !== null && typeof value === "object" && !Array.isArray(value)) {
		const obj = value as Record<string, unknown>;
		const propsRaw = schema.properties;
		const props = propsRaw && typeof propsRaw === "object" ? (propsRaw as Record<string, Record<string, unknown>>) : null;
		const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
		for (const key of required) {
			if (!(key in obj)) issues.push({ path: `${path}.${key}`, msg: "required property is missing" });
		}
		const allowExtra = schema.additionalProperties !== false;
		for (const [key, sub] of Object.entries(obj)) {
			const subSchema = props?.[key];
			if (subSchema) {
				walk(subSchema, sub, `${path}.${key}`, issues);
			} else if (!allowExtra) {
				issues.push({ path: `${path}.${key}`, msg: "additional property is not allowed" });
			}
		}
	}

	if (type === "array" && Array.isArray(value)) {
		const itemsRaw = schema.items;
		const items = itemsRaw && typeof itemsRaw === "object" ? (itemsRaw as Record<string, unknown>) : null;
		const max = typeof schema.maxItems === "number" ? schema.maxItems : Infinity;
		const min = typeof schema.minItems === "number" ? schema.minItems : 0;
		if (value.length > max) issues.push({ path, msg: `has ${value.length} items (max ${max})` });
		if (value.length < min) issues.push({ path, msg: `has ${value.length} items (min ${min})` });
		if (items) value.forEach((v, i) => walk(items, v, `${path}[${i}]`, issues));
	}

	if (type === "string" && typeof value === "string") {
		const pat = typeof schema.pattern === "string" ? (schema.pattern as string) : null;
		if (pat) {
			let re: RegExp;
			try {
				re = new RegExp(pat);
			} catch {
				issues.push({ path, msg: `declares an invalid pattern ${pat}` });
				re = /$./;
			}
			if (!re.test(value)) issues.push({ path, msg: `does not match pattern ${pat}` });
		}
		if (typeof schema.minLength === "number" && value.length < schema.minLength) {
			issues.push({ path, msg: `is too short (min ${schema.minLength} chars)` });
		}
		if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
			issues.push({ path, msg: `is too long (max ${schema.maxLength} chars)` });
		}
	}

	if ((type === "number" || type === "integer") && typeof value === "number") {
		if (typeof schema.minimum === "number" && value < schema.minimum) {
			issues.push({ path, msg: `must be ≥ ${schema.minimum}` });
		}
		if (typeof schema.maximum === "number" && value > schema.maximum) {
			issues.push({ path, msg: `must be ≤ ${schema.maximum}` });
		}
	}
}

