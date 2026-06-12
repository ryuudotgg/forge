export interface Choices<Id extends string> {
	readonly available: (id: Id) => boolean;
	readonly ids: ReadonlyArray<Id>;
	readonly label: (id: Id) => string;
}

export function unavailableMessage<Id extends string>(
	choices: Choices<Id>,
	id: Id,
) {
	return `${choices.label(id)} isn't available yet.`;
}

export function availableChoice<Id extends string>(choices: Choices<Id>) {
	return (id: Id) =>
		choices.available(id) ? undefined : unavailableMessage(choices, id);
}

export function choiceOptions<Id extends string>(choices: Choices<Id>) {
	return choices.ids.map((id) => ({
		label: choices.label(id),
		value: id,
		...(choices.available(id) ? {} : { hint: "coming soon" }),
	}));
}
