import { listAnd } from "./list";

export interface Choices<Id extends string> {
	readonly available: (id: Id) => boolean;
	readonly ids: ReadonlyArray<Id>;
	readonly label: (id: Id) => string;
}

export function unsupportedMessage<Id extends string>(
	choices: Choices<Id>,
	ids: ReadonlyArray<Id>,
) {
	return `We don't support ${listAnd.format(ids.map((id) => choices.label(id)))} yet.`;
}

export function availableChoice<Id extends string>(choices: Choices<Id>) {
	return (id: Id) =>
		choices.available(id) ? undefined : unsupportedMessage(choices, [id]);
}

export function choiceOptions<Id extends string>(choices: Choices<Id>) {
	return choices.ids.map((id) => ({
		label: choices.label(id),
		value: id,
		...(choices.available(id) ? {} : { hint: "coming soon" }),
	}));
}
