import type * as Effect from "effect/Effect";
import type { Apply } from "../src/apply";
import type {
	validateAdapterAgainstModule,
	validateAddonAgainstSelection,
} from "../src/authoring";
import type {
	ApplyErrors,
	PlannerErrors,
	RegistryError,
	RegistryErrors,
	StateErrors,
	SubprocessError,
} from "../src/errors";
import type { Planner } from "../src/planner";
import type { State } from "../src/state";
import type { Subprocess } from "../src/subprocess";

type EffectErrors<Services> = {
	readonly [Key in keyof Services]: Services[Key] extends (
		...arguments_: infer _Arguments
	) => Effect.Effect<infer _Success, infer Error, infer _Requirements>
		? Error
		: never;
}[keyof Services];

type Assert<Condition extends true> = Condition;
type Equal<Left, Right> = [Left] extends [Right]
	? [Right] extends [Left]
		? true
		: false
	: false;

type PlannerEffectErrors = EffectErrors<Planner["Service"]>;
type ApplyEffectErrors = EffectErrors<Apply["Service"]>;
type StateEffectErrors = EffectErrors<State["Service"]>;
type SubprocessEffectErrors = EffectErrors<Subprocess["Service"]>;
type RegistryEffectErrors =
	| RegistryError
	| Effect.Error<ReturnType<typeof validateAddonAgainstSelection>>
	| Effect.Error<ReturnType<typeof validateAdapterAgainstModule>>;

type _PlannerErrorsAreComplete = Assert<
	Equal<PlannerEffectErrors, PlannerErrors>
>;
type _ApplyErrorsAreComplete = Assert<Equal<ApplyEffectErrors, ApplyErrors>>;
type _StateErrorsAreComplete = Assert<Equal<StateEffectErrors, StateErrors>>;
type _SubprocessErrorsAreComplete = Assert<
	Equal<SubprocessEffectErrors, SubprocessError>
>;
type _RegistryErrorsAreComplete = Assert<
	Equal<RegistryEffectErrors, RegistryErrors>
>;
type _RecipeRegistryReasonsAreComplete = Assert<
	Equal<
		Extract<RegistryError["reason"], `recipe-${string}`>,
		| "recipe-marker-missing"
		| "recipe-marker-invalid"
		| "recipe-marker-undeclared"
		| "recipe-toggle-residue"
		| "recipe-destination-collision"
		| "recipe-framework-unknown"
		| "recipe-slot-unknown"
	>
>;
