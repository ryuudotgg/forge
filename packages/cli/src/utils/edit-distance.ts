export function editDistance(left: string, right: string): number {
	const rightCharacters = Array.from(right);

	let previous = Array.from(
		{ length: rightCharacters.length + 1 },
		(_, index) => index,
	);

	for (const [leftIndex, leftCharacter] of Array.from(left).entries()) {
		const current = [leftIndex + 1];
		for (const [rightIndex, rightCharacter] of rightCharacters.entries())
			current.push(
				Math.min(
					(current[rightIndex] ?? 0) + 1,
					(previous[rightIndex + 1] ?? 0) + 1,
					(previous[rightIndex] ?? 0) +
						(leftCharacter === rightCharacter ? 0 : 1),
				),
			);

		previous = current;
	}

	return previous.at(-1) ?? 0;
}
