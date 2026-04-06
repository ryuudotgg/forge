export const listOr = new Intl.ListFormat("en", { type: "disjunction" });
export const listAnd = new Intl.ListFormat("en", { type: "conjunction" });

export const plural = (count: number, singular: string, pluralForm?: string) =>
	count === 1 ? singular : (pluralForm ?? `${singular}s`);
