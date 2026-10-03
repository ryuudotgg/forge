import {
	type AuthColumn,
	type AuthTable,
	authColumnName,
	authModels,
} from "../../auth/tables";
import type { PrismaDatasourceProvider } from "../../data/providers";

function prismaColumn(
	column: AuthColumn,
	datasource: PrismaDatasourceProvider,
): string {
	const types = {
		text: "String",
		reference: "String",
		integer: "Int",
		boolean: "Boolean",
		date: "DateTime",
	};

	const type = `${types[column.type]}${column.presence === "nullable" ? "?" : ""}`;
	const name = column.sqlName ?? authColumnName(column.name);
	const attributes = [
		...(column.type === "text" && column.index === "unique" ? ["@unique"] : []),
		...(name !== column.name ? [`@map("${name}")`] : []),
		...(column.type === "text" && datasource === "mysql" ? ["@db.Text"] : []),
		...(column.type === "date" && datasource === "postgresql"
			? ["@db.Timestamptz"]
			: []),
	];

	return `  ${column.name} ${type}${attributes.length > 0 ? ` ${attributes.join(" ")}` : ""}`;
}

export function prismaUserRelations(tables: ReadonlyArray<AuthTable>): string {
	return tables
		.flatMap((table) =>
			table.columns.flatMap((column) => {
				if (column.type !== "reference" || column.target !== "user") return [];
				return [`  ${column.inverse} ${authModels[table.model].prisma}[]\n`];
			}),
		)
		.join("");
}

export function renderPrismaAuthTables(
	tables: ReadonlyArray<AuthTable>,
	datasource: PrismaDatasourceProvider,
): string {
	return tables
		.map((table) => {
			const relations = table.columns.flatMap((column) => {
				if (column.type !== "reference") return [];

				return [
					`  ${column.relation} ${authModels[column.target].prisma}${column.presence === "nullable" ? "?" : ""} @relation(fields: [${column.name}], references: [id], onDelete: Cascade)`,
				];
			});

			const indexes = table.columns.flatMap((column) => {
				if (
					column.type !== "reference" &&
					!(column.type === "text" && column.index === "lookup")
				)
					return [];

				const prefix =
					column.type === "text" && datasource === "mysql"
						? "(length: 191)"
						: "";

				return [`  @@index([${column.name}${prefix}])`];
			});

			return [
				"",
				`model ${authModels[table.model].prisma} {`,
				"  id String @id",
				...table.columns.map((column) => prismaColumn(column, datasource)),
				"",
				...relations,
				"",
				...indexes,
				"",
				`  @@map("${authModels[table.model].table}")`,
				"}",
				"",
			].join("\n");
		})
		.join("");
}
