/**
 * A translation of an English namespace: exactly the same keys, every value a string.
 * A missing or extra key is a type error, so `tsc` catches an incomplete catalog.
 */
export type Translations<T> = { [K in keyof T]: string };

/** Source-string catalog for server messages: English text → translation. */
export type ServerMessages = Record<string, string>;

/** A pattern rule for server messages with variable parts (`$1` refers to the first group). */
export type ServerMessagePattern = readonly [RegExp, string];
