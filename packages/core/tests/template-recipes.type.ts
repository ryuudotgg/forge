import { defineRegistry } from "../src/index";

defineRegistry({
	frameworks: [],
	templates: [],
	addons: [],
});

defineRegistry({
	frameworks: [],
	templates: [],
	addons: [],
	recipes: [],
	readTemplate: () => "",
});

// @ts-expect-error recipes require readTemplate
defineRegistry({
	frameworks: [],
	templates: [],
	addons: [],
	recipes: [],
});

// @ts-expect-error readTemplate requires recipes
defineRegistry({
	frameworks: [],
	templates: [],
	addons: [],
	readTemplate: () => "",
});
