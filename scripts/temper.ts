export interface Temper {
	readonly branches: number;
	readonly lines: number;
}

export interface TemperedPackage {
	readonly directory: string;
	readonly temper: Temper;
}

export const PACKAGES = {
	"@ryuujs/core": {
		directory: "packages/core",
		temper: { branches: 63, lines: 79 },
	},
	"@ryuujs/forge": {
		directory: "packages/cli",
		temper: { branches: 14, lines: 26 },
	},
	"@ryuujs/generators": {
		directory: "packages/generators",
		temper: { branches: 44, lines: 52 },
	},
} satisfies Record<string, TemperedPackage>;
