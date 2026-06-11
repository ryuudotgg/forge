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
		temper: { branches: 80, lines: 90 },
	},
	"@ryuujs/forge": {
		directory: "packages/cli",
		temper: { branches: 80, lines: 90 },
	},
	"@ryuujs/generators": {
		directory: "packages/generators",
		temper: { branches: 80, lines: 90 },
	},
} satisfies Record<string, TemperedPackage>;
