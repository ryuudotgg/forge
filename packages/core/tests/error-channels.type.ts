import type { Effect } from "effect";
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
} from "../src/errors";
import type { Planner } from "../src/planner";
import type { State } from "../src/state";

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

type PlannerEffectErrors = EffectErrors<Planner>;
type ApplyEffectErrors = EffectErrors<Apply>;
type StateEffectErrors = EffectErrors<State>;
type RegistryEffectErrors =
	| RegistryError
	| Effect.Effect.Error<ReturnType<typeof validateAddonAgainstSelection>>
	| Effect.Effect.Error<ReturnType<typeof validateAdapterAgainstModule>>;

type _PlannerErrorsAreComplete = Assert<
	Equal<PlannerEffectErrors, PlannerErrors>
>;
type _ApplyErrorsAreComplete = Assert<Equal<ApplyEffectErrors, ApplyErrors>>;
type _StateErrorsAreComplete = Assert<Equal<StateEffectErrors, StateErrors>>;
type _RegistryErrorsAreComplete = Assert<
	Equal<RegistryEffectErrors, RegistryErrors>
>;
