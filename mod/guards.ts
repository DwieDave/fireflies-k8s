// The k8s window's own guards beside guard.ts (a shared copy, kept as the app
// ships it): what kubectl's JSON needs that guard.ts doesn't have. Imports
// nothing at run time, so a test can load it as it is.

import type { Guard } from "./guard.ts";

/** Any array: its items still to be proven one by one (a list that keeps the good ones). */
export const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value);

/** A field kubectl may leave out or send as null: a T, null or undefined. */
export function maybe<T>(guard: Guard<T>): Guard<T | null | undefined> {
  return (value: unknown): value is T | null | undefined => value === null || value === undefined || guard(value);
}

/** A JSON object whose keys are data (labels, a config map's keys), as it comes in. */
export type JsonMap<T> = { readonly [key: string]: T | undefined };

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null && !Array.isArray(value);

/** A JSON object keyed by data whose every value is a T. */
export function mapOf<T>(entry: Guard<T>): Guard<JsonMap<T>> {
  return (value: unknown): value is JsonMap<T> => isObject(value) && Object.keys(value).every((key) => entry(Object.getOwnPropertyDescriptor(value, key)?.value));
}

/** A proven JSON object keyed by data as a Map. */
export function toMap<T>(json: JsonMap<T> | null | undefined): Map<string, T> {
  const out = new Map<string, T>();

  for (const [key, value] of Object.entries(json ?? {})) if (value !== undefined) out.set(key, value);

  return out;
}

/** A JSON object of any fields (spec and status sections read later by their own guards). */
export const isRecord = (value: unknown): value is object => isObject(value);

/** A number or its text ("8080" or 8080: a target port, a quantity). */
export const isNumberish = (value: unknown): value is number | string => (typeof value === "number" && Number.isFinite(value)) || typeof value === "string";
