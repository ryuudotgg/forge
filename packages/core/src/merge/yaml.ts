import { formatJsonPath } from "./json";
import type { LineMergeConflict, LineMergeResult } from "./lines";
import type { MergeConflictResolution, MergeConflictResolver } from "./types";

type Item<Value> =
	| { readonly kind: "text"; readonly line: string }
	| { readonly kind: "keyed"; readonly key: string; readonly value: Value };

interface Entry {
	readonly line: string;
	readonly value: string;
}

type Body =
	| {
			readonly kind: "empty" | "mapping" | "sequence";
			readonly items: Item<Entry>[];
	  }
	| { readonly kind: "opaque"; readonly lines: string[] };

interface Block {
	readonly head: string;
	readonly body: Body;
}

interface MergeContext {
	readonly resolution?: MergeConflictResolution;
	readonly resolveConflict?: MergeConflictResolver;
	readonly syntheticBase: boolean;
	readonly conflicts: LineMergeConflict[];
}

function isBlank(line: string): boolean {
	return line.trim() === "";
}

function isText(line: string): boolean {
	return isBlank(line) || line.trimStart().startsWith("#");
}

function unquote(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	)
		return value.slice(1, -1);

	return value;
}

function splitComment(value: string): { scalar: string; comment: string } {
	const trimmed = value.trimStart();
	const quote = trimmed[0];
	const closing =
		quote === '"' || quote === "'" ? trimmed.indexOf(quote, 1) + 1 : 0;

	const match = /(?:^|\s+)#.*$/.exec(trimmed.slice(closing));
	if (match === null) return { scalar: trimmed.trimEnd(), comment: "" };

	const start = closing + match.index;
	return {
		scalar: trimmed.slice(0, start).trimEnd(),
		comment: trimmed.slice(start),
	};
}

function normalizeValue(value: string): string {
	return unquote(splitComment(value).scalar);
}

function withUserComment(merged: Entry, current: Entry | undefined): Entry {
	const userComment =
		current === undefined ? "" : splitComment(current.value).comment;
	if (userComment === "" || splitComment(merged.value).comment !== "")
		return merged;

	return {
		line: `${merged.line.trimEnd()}${userComment}`,
		value: `${merged.value.trimEnd()}${userComment}`,
	};
}

function mappingPair(line: string): { key: string; value: string } | undefined {
	const match =
		/^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s:#][^:]*):(?:\s+(.*)|\s*)$/.exec(
			line,
		);

	if (match?.[1] === undefined) return undefined;

	return { key: unquote(match[1].trim()), value: match[2] ?? "" };
}

function parseBody(head: string, lines: string[]): Body {
	const inlineValue = mappingPair(head)?.value.trim() ?? "";
	if (inlineValue !== "" && !inlineValue.startsWith("#"))
		return { kind: "opaque", lines };

	const items: Item<Entry>[] = [];
	const keys = new Set<string>();

	let kind: "empty" | "mapping" | "sequence" = "empty";
	let indentation: string | undefined;
	for (const line of lines) {
		if (isText(line)) {
			items.push({ kind: "text", line });
			continue;
		}

		const leading = /^ */.exec(line)?.[0] ?? "";
		indentation ??= leading;

		const entry = line.slice(leading.length);
		if (leading !== indentation || /^(?:-\s+)?"[^"]*\\/.test(entry))
			return { kind: "opaque", lines };

		const sequence = /^-\s+(.+)$/.exec(entry);
		const mapping =
			sequence === null && leading !== "" ? mappingPair(entry) : undefined;

		const entryKind = sequence === null ? "mapping" : "sequence";
		const value = sequence?.[1] ?? mapping?.value;
		const key =
			sequence?.[1] === undefined ? mapping?.key : normalizeValue(sequence[1]);

		if (
			key === undefined ||
			value === undefined ||
			keys.has(key) ||
			(kind !== "empty" && kind !== entryKind)
		)
			return { kind: "opaque", lines };

		kind = entryKind;
		keys.add(key);
		items.push({ kind: "keyed", key, value: { line, value } });
	}

	return { kind, items };
}

function parseDocument(content: string): Item<Block>[] | undefined {
	const lines = content.replaceAll("\r\n", "\n").split("\n");
	if (lines.at(-1) === "") lines.pop();

	const items: Item<Block>[] = [];
	const keys = new Set<string>();
	let pending: Item<Block>[] = [];
	let active: { key: string; head: string; lines: string[] } | undefined;
	const finishBlock = () => {
		if (active !== undefined)
			items.push({
				kind: "keyed",
				key: active.key,
				value: {
					head: active.head,
					body: parseBody(active.head, active.lines),
				},
			});
	};

	for (const line of lines) {
		if (isText(line)) {
			pending.push({ kind: "text", line });
			continue;
		}

		if (/^\s/.test(line) || line.startsWith("- ")) {
			if (active === undefined) return undefined;

			for (const item of pending)
				if (item.kind === "text") active.lines.push(item.line);

			pending = [];
			active.lines.push(line);
			continue;
		}

		const pair = mappingPair(line);
		if (pair === undefined || keys.has(pair.key)) return undefined;

		finishBlock();
		items.push(...pending);
		pending = [];
		keys.add(pair.key);
		active = { key: pair.key, head: line, lines: [] };
	}

	finishBlock();
	items.push(...pending);

	return items;
}

function keyedValues<Value>(
	items: ReadonlyArray<Item<Value>>,
): Map<string, Value> {
	return new Map(
		items.flatMap((item) =>
			item.kind === "keyed" ? [[item.key, item.value]] : [],
		),
	);
}

function identity<Value>(item: Item<Value>): string | undefined {
	if (item.kind === "keyed") return `key:${item.key}`;
	return isBlank(item.line) ? undefined : `text:${item.line}`;
}

function isBlankItem<Value>(item: Item<Value> | undefined): boolean {
	return item?.kind === "text" && isBlank(item.line);
}

function mergeKeyedSequence<Value>(
	base: ReadonlyArray<Item<Value>>,
	current: ReadonlyArray<Item<Value>>,
	incoming: ReadonlyArray<Item<Value>>,
	mergeValue: (
		key: string,
		base: Value | undefined,
		current: Value | undefined,
		incoming: Value | undefined,
	) => Value | undefined,
	formatInsertedText: (line: string) => string = (line) => line,
): Item<Value>[] {
	const baseValues = keyedValues(base);
	const currentValues = keyedValues(current);
	const incomingValues = keyedValues(incoming);
	const mergedValues = new Map<string, Value>();
	for (const key of new Set([
		...baseValues.keys(),
		...currentValues.keys(),
		...incomingValues.keys(),
	])) {
		const value = mergeValue(
			key,
			baseValues.get(key),
			currentValues.get(key),
			incomingValues.get(key),
		);

		if (value !== undefined) mergedValues.set(key, value);
	}

	const baseText = new Set(
		base.flatMap((item) =>
			item.kind === "text" && !isBlank(item.line) ? [item.line] : [],
		),
	);

	const incomingText = new Set(
		incoming.flatMap((item) =>
			item.kind === "text" && !isBlank(item.line) ? [item.line] : [],
		),
	);

	const forgeRemoved = (item: Item<Value>, index: number) => {
		if (item.kind === "keyed") return !mergedValues.has(item.key);
		if (!baseText.has(item.line) || incomingText.has(item.line)) return false;

		for (const following of current.slice(index + 1)) {
			if (following.kind === "text") break;
			if (mergedValues.has(following.key)) return false;
		}

		return true;
	};

	const output: Item<Value>[] = [];

	let removedSinceKept = false;
	for (const [index, item] of current.entries()) {
		if (forgeRemoved(item, index)) {
			removedSinceKept = true;
			continue;
		}

		if (
			removedSinceKept &&
			isBlankItem(item) &&
			(output.length === 0 || isBlankItem(output.at(-1)))
		)
			continue;

		removedSinceKept = false;
		output.push(
			item.kind === "keyed"
				? { ...item, value: mergedValues.get(item.key) ?? item.value }
				: item,
		);
	}

	if (removedSinceKept) while (isBlankItem(output.at(-1))) output.pop();

	const inOutput = (item: Item<Value>) =>
		output.some((candidate) => identity(candidate) === identity(item));

	const willInsert = (item: Item<Value>) =>
		item.kind === "keyed" && !inOutput(item) && mergedValues.has(item.key);

	const headsInsertedEntry = (index: number) => {
		for (const following of incoming.slice(index + 1)) {
			if (following.kind === "keyed") return willInsert(following);
			if (isBlank(following.line)) return false;
		}

		return false;
	};

	let anchor: Item<Value> | undefined;
	let blanks: Item<Value>[] = [];
	for (const [index, item] of incoming.entries()) {
		const itemIdentity = identity(item);
		if (itemIdentity === undefined) {
			blanks.push(item);
			continue;
		}

		const existing = output.find(
			(candidate) => identity(candidate) === itemIdentity,
		);

		const shouldInsert =
			existing === undefined &&
			(item.kind === "keyed"
				? mergedValues.has(item.key)
				: !baseText.has(item.line) && headsInsertedEntry(index));

		if (shouldInsert) {
			let insertAt = anchor === undefined ? 0 : output.indexOf(anchor) + 1;
			if (blanks.length > 0)
				while (true) {
					const next = output[insertAt];
					if (next?.kind !== "keyed" || incomingValues.has(next.key)) break;
					insertAt++;
				}

			const inserted =
				item.kind === "keyed"
					? { ...item, value: mergedValues.get(item.key) ?? item.value }
					: { ...item, line: formatInsertedText(item.line) };

			output.splice(insertAt, 0, ...blanks, inserted);
			anchor = inserted;
		}

		if (existing !== undefined) anchor = existing;

		blanks = [];
	}

	return output;
}

function mergeScalar<Value>(
	label: string,
	base: Value | undefined,
	current: Value | undefined,
	incoming: Value | undefined,
	compare: (value: Value) => string,
	display: (value: Value) => string,
	context: MergeContext,
): Value | undefined {
	const equal = (left: Value | undefined, right: Value | undefined) =>
		left === undefined || right === undefined
			? left === right
			: compare(left) === compare(right);

	if (equal(current, incoming)) return current;
	if (context.syntheticBase && current === undefined) return incoming;
	if (!context.syntheticBase) {
		if (equal(base, incoming)) return current;
		if (equal(base, current)) return incoming;
	}

	context.conflicts.push({
		label,
		...(base === undefined ? {} : { base: display(base) }),
		...(current === undefined ? {} : { user: display(current) }),
		...(incoming === undefined ? {} : { forge: display(incoming) }),
	});

	return (context.resolveConflict?.(label) ?? context.resolution) === "user"
		? current
		: incoming;
}

function blockLines(block: Block): string[] {
	return [
		block.head,
		...(block.body.kind === "opaque"
			? block.body.lines
			: block.body.items.map((item) =>
					item.kind === "text" ? item.line : item.value.line,
				)),
	];
}

function mergeBlock(
	key: string,
	base: Block | undefined,
	current: Block | undefined,
	incoming: Block | undefined,
	context: MergeContext,
): Block | undefined {
	const blocks = [base, current, incoming].filter(
		(block) => block !== undefined,
	);

	const kinds = new Set(
		blocks.map((block) => block.body.kind).filter((kind) => kind !== "empty"),
	);

	if (kinds.has("opaque") || kinds.size > 1)
		return mergeScalar(
			key,
			base,
			current,
			incoming,
			(block) =>
				[
					block.body.kind,
					normalizeValue(mappingPair(block.head)?.value ?? ""),
					...blockLines(block).slice(1),
				].join("\n"),
			(block) => blockLines(block).join("\n"),
			context,
		);

	const template = current ?? incoming;
	if (template === undefined) return undefined;

	const kind =
		template.body.kind === "empty"
			? (incoming?.body.kind ?? base?.body.kind ?? "empty")
			: template.body.kind;

	if (kind === "opaque") return undefined;

	const entries = (block: Block | undefined) =>
		block === undefined || block.body.kind === "opaque" ? [] : block.body.items;

	const currentEntry = entries(current).find((item) => item.kind === "keyed");
	const indentation =
		currentEntry?.kind === "keyed"
			? (/^\s*/.exec(currentEntry.value.line)?.[0] ?? "  ")
			: "  ";

	const items = mergeKeyedSequence(
		entries(base),
		entries(current),
		entries(incoming),
		(entryKey, baseEntry, currentValue, incomingEntry) => {
			const label =
				kind === "sequence"
					? `${formatJsonPath([key])}[${JSON.stringify(entryKey)}]`
					: formatJsonPath([key, entryKey]);

			const merged = mergeScalar(
				label,
				baseEntry,
				currentValue,
				incomingEntry,
				(entry) => normalizeValue(entry.value),
				(entry) => entry.value,
				context,
			);

			if (merged === undefined || merged === currentValue) return merged;

			const annotated = withUserComment(merged, currentValue);

			return {
				...annotated,
				line: `${indentation}${annotated.line.trimStart()}`,
			};
		},
		(line) => `${indentation}${line.trimStart()}`,
	);

	if (items.length === 0 && (current === undefined || incoming === undefined)) {
		if (
			blocks.some((block) =>
				entries(block).some((item) => item.kind === "keyed"),
			)
		)
			return undefined;

		return mergeScalar(
			key,
			base,
			current,
			incoming,
			() => "",
			(block) => block.head,
			context,
		);
	}

	return { head: template.head, body: { kind, items } };
}

export function threeWayMergeYaml(
	base: string,
	current: string,
	incoming: string,
	resolution?: MergeConflictResolution,
	resolveConflict?: MergeConflictResolver,
	syntheticBase = false,
): LineMergeResult | undefined {
	const baseItems = parseDocument(base);
	const currentItems = parseDocument(current);
	const incomingItems = parseDocument(incoming);
	if (
		baseItems === undefined ||
		currentItems === undefined ||
		incomingItems === undefined
	)
		return undefined;

	const context: MergeContext = {
		resolution,
		resolveConflict,
		syntheticBase,
		conflicts: [],
	};

	const items = mergeKeyedSequence(
		baseItems,
		currentItems,
		incomingItems,
		(key, baseBlock, currentBlock, incomingBlock) =>
			mergeBlock(key, baseBlock, currentBlock, incomingBlock, context),
	);

	const lines = items.flatMap((item) =>
		item.kind === "text" ? [item.line] : blockLines(item.value),
	);

	return {
		merged: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		conflicts: context.conflicts.map((conflict) => conflict.label),
		...(context.conflicts.length === 0
			? {}
			: { conflictValues: context.conflicts }),
	};
}
