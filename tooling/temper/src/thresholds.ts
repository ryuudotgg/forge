export interface CoverageThreshold {
	readonly branches: number;
	readonly lines: number;
}

export interface Temper extends CoverageThreshold {
	readonly perFileOverrides?: Readonly<Record<string, CoverageThreshold>>;
}

export interface TemperedPackage {
	readonly directory: string;
	readonly temper: Temper;
}

export const PACKAGES = {
	"@ryuujs/core": {
		directory: "packages/core",
		temper: { branches: 80, lines: 90, perFileOverrides: {} },
	},
	"@ryuujs/forge": {
		directory: "packages/cli",
		temper: {
			branches: 80,
			lines: 90,
			perFileOverrides: {
				"src/index.ts": { branches: 80, lines: 90 },
			},
		},
	},
	"@ryuujs/generators": {
		directory: "packages/generators",
		temper: { branches: 80, lines: 90, perFileOverrides: {} },
	},
} satisfies Record<string, TemperedPackage>;
