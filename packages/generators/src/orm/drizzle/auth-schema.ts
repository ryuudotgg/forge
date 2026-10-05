import {
	type AuthColumn,
	type AuthTable,
	authColumnName,
	authColumns,
	authModels,
	mysqlIndexPrefix,
} from "../../auth/tables";
import type { Database } from "../../config";

function drizzleColumn(
	column: AuthColumn,
	dialect: Database,
	foreignKeys: boolean,
): string {
	const sqlName = column.sqlName ? `"${column.sqlName}"` : "";
	let value: string;

	switch (column.type) {
		case "reference":
			value = dialect === "mysql" ? "varchar({ length: 36 })" : "text()";
			break;
		case "text":
			value =
				dialect === "mysql" &&
				column.unbounded !== true &&
				(column.index !== undefined || column.default !== undefined)
					? `varchar(${sqlName ? `${sqlName}, ` : ""}{ length: 255 })`
					: `text(${sqlName})`;
			break;
		case "integer":
			value = dialect === "mysql" ? "int()" : "integer()";
			break;
		case "boolean":
			value =
				dialect === "sqlite" ? 'integer({ mode: "boolean" })' : "boolean()";
			break;
		case "date":
			value =
				dialect === "sqlite"
					? 'integer({ mode: "timestamp_ms" })'
					: dialect === "mysql"
						? "timestamp({ fsp: 3 })"
						: "timestamp({ withTimezone: true })";
			break;
	}

	const required = column.presence === "required" ? ".notNull()" : "";

	if (column.type === "reference" && foreignKeys)
		return `    ${column.name}: ${value}\n      ${required}\n      .references(() => ${authModels[column.target].table}.id, { onDelete: "${column.onDelete}" }),`;

	const unique =
		column.type === "text" && column.index === "unique" ? ".unique()" : "";
	const defaultValue =
		column.type === "reference" || column.default === undefined
			? ""
			: column.type === "date"
				? dialect === "sqlite"
					? ".default(unixepochMs)"
					: ".defaultNow()"
				: `.default(${JSON.stringify(column.default)})`;

	return `    ${column.name}: ${value}${required}${unique}${defaultValue},`;
}

function drizzleIndexes(
	table: AuthTable,
	dialect: Database,
	foreignKeys: boolean,
): ReadonlyArray<string> {
	const identity = authModels[table.model];

	return authColumns(table).flatMap((column) => {
		if (column.type === "reference" && dialect === "mysql" && foreignKeys)
			return [];

		if (
			column.type !== "reference" &&
			!(column.type === "text" && column.index === "lookup")
		)
			return [];

		const key =
			dialect === "mysql" && column.type === "text" && column.unbounded
				? `sql\`\${table.${column.name}}(${mysqlIndexPrefix})\``
				: `table.${column.name}`;

		return [
			`    index("${identity.table}_${column.sqlName ?? authColumnName(column.name)}_idx").on(${key}),`,
		];
	});
}

function drizzleIndexBlock(
	indexes: ReadonlyArray<string>,
): ReadonlyArray<string> {
	const [only, ...rest] = indexes;
	const inline =
		only === undefined || rest.length > 0
			? undefined
			: `  (table) => [${only.trim().replace(/,$/, "")}],`;

	if (inline !== undefined && inline.length <= 80) return [inline];

	return ["  (table) => [", ...indexes, "  ],"];
}

function drizzleTable(
	table: AuthTable,
	dialect: Database,
	foreignKeys: boolean,
): string {
	const identity = authModels[table.model];
	const id = dialect === "mysql" ? "varchar({ length: 36 })" : "text()";
	const indexes = drizzleIndexes(table, dialect, foreignKeys);

	const columns = [
		`    id: ${id}.primaryKey(),`,
		...table.references.map((column) =>
			drizzleColumn(column, dialect, foreignKeys),
		),
		...table.groups.flatMap((group) => [
			"",
			...group.map((column) => drizzleColumn(column, dialect, foreignKeys)),
		]),
	];

	if (indexes.length === 0)
		return [
			`export const ${identity.table} = snakeCase.table("${identity.table}", {`,
			...columns.map((line) => line.replace(/^ {2}/gm, "")),
			"});",
			"",
		].join("\n");

	return [
		`export const ${identity.table} = snakeCase.table(`,
		`  "${identity.table}",`,
		"  {",
		...columns,
		"  },",
		...drizzleIndexBlock(indexes),
		");",
		"",
	].join("\n");
}

export function renderDrizzleAuthTables(
	content: string,
	tables: ReadonlyArray<AuthTable>,
	dialect: Database,
	foreignKeys: boolean,
): string {
	const imports = new Set<string>();

	for (const table of tables) {
		if (drizzleIndexes(table, dialect, foreignKeys).length > 0)
			imports.add("index");

		for (const column of authColumns(table)) {
			if (column.type === "boolean" && dialect !== "sqlite")
				imports.add("boolean");
			if (column.type === "integer")
				imports.add(dialect === "mysql" ? "int" : "integer");
		}
	}

	const updated = content.replace(
		/import \{ ([^}]+) \} from "(drizzle-orm\/(?:pg|mysql|sqlite)-core)";/,
		(_match, names: string, module: string) => {
			for (const name of names.split(", ")) imports.add(name);

			const sorted = [...imports].sort();
			const line = `import { ${sorted.join(", ")} } from "${module}";`;
			return line.length <= 80
				? line
				: `import {\n${sorted.map((name) => `  ${name},`).join("\n")}\n} from "${module}";`;
		},
	);

	if (tables.length === 0) return updated;

	const sqlImport = 'import { sql } from "drizzle-orm";\n';
	const prefixesIndexes =
		dialect === "mysql" &&
		tables.some((table) =>
			authColumns(table).some(
				(column) => column.type === "text" && column.unbounded === true,
			),
		);

	const header =
		prefixesIndexes && !updated.includes(sqlImport)
			? `${sqlImport}${updated}`
			: updated;

	return `${header}\n${tables.map((table) => drizzleTable(table, dialect, foreignKeys)).join("\n")}`;
}

export function drizzleUserRelations(tables: ReadonlyArray<AuthTable>): string {
	return tables
		.flatMap((table) =>
			authColumns(table).flatMap((column) => {
				if (column.type !== "reference" || column.target !== "user") return [];

				const source = authModels[table.model].table;
				return [
					`    ${column.inverse}: r.many.${source}({\n      from: r.users.id,\n      to: r.${source}.${column.name},\n    }),\n`,
				];
			}),
		)
		.join("");
}

export function drizzleTableRelations(
	tables: ReadonlyArray<AuthTable>,
): string {
	return tables
		.map((table) => {
			const source = authModels[table.model].table;
			const inverse = tables.flatMap((other) =>
				authColumns(other).flatMap((column) => {
					if (column.type !== "reference" || column.target !== table.model)
						return [];

					const target = authModels[other.model].table;
					return [
						`    ${column.inverse}: r.many.${target}({\n      from: r.${source}.id,\n      to: r.${target}.${column.name},\n    }),`,
					];
				}),
			);

			const relations = authColumns(table).flatMap((column) => {
				if (column.type !== "reference") return [];

				const target = authModels[column.target].table;
				return [
					`    ${column.relation}: r.one.${target}({\n      from: r.${source}.${column.name},\n      to: r.${target}.id,\n      optional: ${column.presence === "nullable"},\n    }),`,
				];
			});

			return `\n  ${source}: {\n${[...relations, ...inverse].join("\n")}\n  },\n`;
		})
		.join("");
}
