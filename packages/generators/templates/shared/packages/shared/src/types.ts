export type NonEmptyArray<T> = readonly [T, ...T[]];

export function isNonEmpty<T>(
  items: ReadonlyArray<T>,
): items is NonEmptyArray<T> {
  return items.length > 0;
}

export function assertNever(value: never): never {
  throw new Error(`Unexpected value: ${String(value)}`);
}
