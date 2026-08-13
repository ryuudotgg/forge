import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ApplyError,
	DiscoveryError,
	GeneratorError,
	ModuleConfigError,
	PlannerError,
	RegistryError,
	StateError,
	SubprocessError,
} from "../src/index";

describe("structured error rendering", () => {
	const stateCases = [
		["base-hash-failed", "Base Hash Failed"],
		["state-bundle-read-failed", "State Bundle Read Failed"],
		["manifest-directory-failed", "Manifest Directory Failed"],
		["manifest-write-failed", "Manifest Write Failed"],
		["lockfile-read-failed", "Lockfile Read Failed"],
		["lockfile-directory-failed", "Lockfile Directory Failed"],
		["lockfile-write-failed", "Lockfile Write Failed"],
		["base-hash-invalid", "Invalid Base Hash"],
		["base-read-failed", "Base Read Failed"],
		["base-directory-failed", "Base Directory Failed"],
		["base-write-failed", "Base Write Failed"],
		["base-directory-read-failed", "Base Directory Read Failed"],
		["base-remove-failed", "Base Remove Failed"],
	] satisfies ReadonlyArray<readonly [StateError["reason"], string]>;

	const plannerCases = [
		["ensured-module-conflict", "Ensured Module Conflict"],
		["multiple-templates-selected", "Multiple Templates Selected"],
		["definition-dependency-missing", "Definition Dependency Missing"],
		["definition-cycle-detected", "Definition Cycle Detected"],
		["module-root-conflict", "Module Root Conflict"],
		["ensured-module-missing", "Ensured Module Missing"],
		["slot-path-requires-module-target", "Slot Path Requires Module Target"],
		["slot-path-module-missing", "Slot Path Module Missing"],
		["slot-path-target-mismatch", "Slot Path Target Mismatch"],
		["slot-path-invalid", "The slot path escapes its module root."],
		["content-hash-failed", "Content Hash Failed"],
	] satisfies ReadonlyArray<readonly [PlannerError["reason"], string]>;

	it("renders command version probe failures and preserves their cause", () => {
		const cause = new Error("probe exploded");
		const error = new GeneratorError({
			generatorId: "workspace",
			reason: "command-version-probe-failed",
			command: "pnpm --version",
			detail: "probe exploded",
			cause,
		});

		expect(error.message).toBe(
			"Command Version Probe Failed: pnpm --version probe exploded",
		);
		expect(error.cause).toBe(cause);
	});

	it("renders missing command versions and preserves their cause", () => {
		const cause = new Error("version missing");
		const error = new GeneratorError({
			generatorId: "workspace",
			reason: "command-version-missing",
			command: "pnpm",
			cause,
		});

		expect(error.message).toBe("Command Version Missing: pnpm");
		expect(error.cause).toBe(cause);
	});

	it("rejects generator reasons missing their required payload", () => {
		expect(
			() =>
				new GeneratorError({
					generatorId: "workspace",
					reason: "framework-not-supported",
					generatorName: "Tailwind",
				}),
		).toThrow();
		expect(
			Schema.is(GeneratorError)({
				_tag: "GeneratorError",
				generatorId: "workspace",
				reason: "framework-not-supported",
				generatorName: "Tailwind",
			}),
		).toBe(false);
	});

	it("rejects subprocess reasons missing their reason-specific payload", () => {
		const base = {
			_tag: "SubprocessError",
			command: "pnpm",
			args: ["install"],
		};

		expect(Schema.is(SubprocessError)({ ...base, reason: "spawn-error" })).toBe(
			false,
		);
		expect(
			Schema.is(SubprocessError)({ ...base, reason: "timeout-error" }),
		).toBe(false);
		expect(
			Schema.is(SubprocessError)({ ...base, reason: "output-limit-error" }),
		).toBe(false);
		expect(
			Schema.is(SubprocessError)({ ...base, reason: "non-zero-exit" }),
		).toBe(false);
	});

	it("renders invalid framework slots and preserves their cause", () => {
		const cause = new Error("slot validation failed");
		const error = new RegistryError({
			reason: "framework-slots-invalid",
			registryId: "first-party",
			subject: "Next.js has duplicate layout slots",
			cause,
		});

		expect(error.message).toBe(
			"Framework Slots Invalid: Next.js has duplicate layout slots",
		);
		expect(error.cause).toBe(cause);
	});

	it("rejects registry reasons missing their required payload", () => {
		expect(
			Schema.is(RegistryError)({
				_tag: "RegistryError",
				reason: "duplicate",
				registryId: "first-party",
				subject: "nextjs",
			}),
		).toBe(false);
	});

	it("renders module config read failures and preserves their cause", () => {
		const cause = new Error("read denied");
		const error = new ModuleConfigError({
			filePath: "apps/web/forge.json",
			reason: "read-failed",
			cause,
		});

		expect(error.message).toBe("Module Config Read Failed");
		expect(error.cause).toBe(cause);
	});

	it("renders module config directory failures and preserves their cause", () => {
		const cause = new Error("mkdir denied");
		const error = new ModuleConfigError({
			filePath: "apps/web/forge.json",
			reason: "directory-failed",
			cause,
		});

		expect(error.message).toBe("Module Config Directory Failed");
		expect(error.cause).toBe(cause);
	});

	it("renders module config write failures and preserves their cause", () => {
		const cause = new Error("write denied");
		const error = new ModuleConfigError({
			filePath: "apps/web/forge.json",
			reason: "write-failed",
			cause,
		});

		expect(error.message).toBe("Module Config Write Failed");
		expect(error.cause).toBe(cause);
	});

	it("rejects module config reasons missing their required payload", () => {
		expect(
			Schema.is(ModuleConfigError)({
				_tag: "ModuleConfigError",
				filePath: "apps/web/forge.json",
				reason: "parse-failed",
			}),
		).toBe(false);
	});

	it("renders state bundle parse failures and preserves their cause", () => {
		const cause = new Error("unexpected token");
		const error = new StateError({
			filePath: ".forge/state.json",
			reason: "state-bundle-parse-failed",
			detail: "Unexpected token at position 4",
			cause,
		});

		expect(error.message).toBe(
			"State Bundle Parse Failed: Unexpected token at position 4",
		);
		expect(error.cause).toBe(cause);
	});

	it("renders invalid state bundles and preserves their cause", () => {
		const cause = new Error("schema validation failed");
		const error = new StateError({
			filePath: ".forge/state.json",
			reason: "state-bundle-invalid",
			issues: ["manifest.schemaVersion: Expected 1", "lockfile: Missing"],
			cause,
		});

		expect(error.message).toBe(
			"Invalid State Bundle\n  manifest.schemaVersion: Expected 1\n  lockfile: Missing",
		);
		expect(error.cause).toBe(cause);
	});

	it.each(stateCases)(
		"renders the %s state reason and preserves its cause",
		(reason, message) => {
			const cause = new Error(`${reason} cause`);
			const error = new StateError({
				filePath: ".forge/state.json",
				reason,
				cause,
			});

			expect(error.message).toBe(message);
			expect(error.cause).toBe(cause);
		},
	);

	it.each(plannerCases)(
		"renders the %s planner reason and preserves its cause",
		(reason, message) => {
			const cause = new Error(`${reason} cause`);
			const error = new PlannerError({
				path: "apps/web",
				reason,
				cause,
				...(reason === "multiple-templates-selected" && {
					category: "web",
				}),
				...(reason === "slot-path-invalid" && { detail: message }),
			});

			expect(error.reason).toBe(reason);
			if (reason === "multiple-templates-selected")
				expect(error.category).toBe("web");
			expect(error.message).toBe(message);
			expect(error.cause).toBe(cause);
		},
	);

	it("rejects state reasons missing their required payload", () => {
		expect(
			Schema.is(StateError)({
				_tag: "StateError",
				filePath: ".forge/state.json",
				reason: "state-bundle-invalid",
			}),
		).toBe(false);
	});

	it("rejects planner and apply reasons missing their required detail", () => {
		expect(
			Schema.is(PlannerError)({
				_tag: "PlannerError",
				path: "registry",
				reason: "write-path-collision",
			}),
		).toBe(false);
		expect(
			Schema.is(ApplyError)({
				_tag: "ApplyError",
				path: "managed files",
				reason: "preflight-failed",
			}),
		).toBe(false);
	});

	it("renders module discovery failures and preserves their cause", () => {
		const cause = new Error("directory traversal failed");
		const error = new DiscoveryError({
			path: "apps",
			reason: "module-discovery-failed",
			cause,
		});

		expect(error.message).toBe(
			"Module Discovery Failed: Error: directory traversal failed",
		);
		expect(error.cause).toBe(cause);
	});
});
