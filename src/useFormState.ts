import { isPlainObject } from "is-plain-object";
import { useEffect, useMemo, useRef, useState } from "react";
import { ObjectConfig } from "src/config";
import { ObjectState, createObjectState } from "src/fields/objectField";
import { initValue, isInput, isQuery } from "./utils";

// A structural match for useQuery
export type Query<I> = { data: I; loading: boolean; error?: any };

export type InputAndMap<T, I> = {
  input: I;
  map?: (input: Exclude<I, null | undefined>) => T;
  ifUndefined?: T;
  onlyOnce?: boolean;
};

export type QueryAndMap<T, I> = {
  query: Query<I>;
  map: (input: Exclude<I, null | undefined>) => T;
  ifUndefined?: T;
};

/**
 * The opts has for `useFormState`.
 *
 * @typeparam T the form type, which is usually as close as possible to your *GraphQL input*
 * @typeparam I the *form input* type, which is usually the *GraphQL output* type, i.e. the type of the response from your GraphQL query
 */
export type UseFormStateOpts<T, I> = {
  /** The form configuration, should be a module-level const or useMemo'd. */
  config: ObjectConfig<T>;

  /**
   * Provides the form's initial value.
   *
   * User's can either:
   *
   * - Provide no initial value (don't set `init` at all)
   * - Provide an initial value that already matches the form type `T` (i.e. set `init: data`)
   * - Provide an initial value from an object that _almost_ matches the form type `T`,
   *   but needs to be mapped from it's input type `I` to the form type
   *   (i.e. set `init: { input: data, map: (data) => ...}`).
   *
   * The value of using the 3rd option is that: a) we internally `useMemo` on the identity of the
   * `init.input` (i.e. a response from an Apollo hook) and don't require the `map` function
   * to have a stable identity, and also b) we will null-check/undefined-check `init.input` and
   * only call `init.map` if it's set, otherwise we'll use `init.ifDefined` or `{}`, saving you
   * from having to null check within your `init.map` function.
   */
  init?: InputAndMap<T, I> | QueryAndMap<T, I>;

  /**
   * A hook to add custom, cross-field validation rules that can be difficult to setup directly in the config DSL.
   *
   * Does not need to be stable/useMemo'd.
   */
  addRules?: (state: ObjectState<T>) => void;

  /** Whether the form should be read only, when changed it won't re-create the whole form. */
  readOnly?: boolean;

  /**
   * Whether the form is loading.
   *
   * Note that we also will infer loading from `init.input === undefined` or `init.query.loading`,
   * so you only need to set this directly if you're not using either of those conventions.
   */
  loading?: boolean;

  /**
   * Fired when the form should auto-save, i.e. after a) blur and b) all fields are valid.
   *
   * Does not need to be stable/useMemo'd.
   */
  autoSave?: (state: ObjectState<T>) => Promise<unknown>;
};

// If the user's autoSave hook makes some last-minute `.set` calls to sneak
// in some business logic right before their GraphQL mutation call, ignore it
// so that we don't infinite loop.
let isAutoSaving: "queued" | "in-flight" | false = false;

// `pendingAutoSave` is a flag for determining if we need to immediately call `maybeAutoSave` again after the initial Promise finishes
// This could happen if a field triggers auto-save while another field's auto-save is already in progress.
let pendingAutoSave = false;

/**
 * Creates a formState instance for editing in a form.
 */
export function useFormState<T, I>(opts: UseFormStateOpts<T, I>): ObjectState<T> {
  const { config, init, addRules, readOnly = false, loading, autoSave } = opts;

  // Use a ref so our memo'ized `onBlur` always see the latest value
  const autoSaveRef = useRef<((state: ObjectState<T>) => void) | undefined>(autoSave);
  autoSaveRef.current = autoSave;

  const firstRunRef = useRef<boolean>(true);
  // This is a little weird, but we need to know ahead of time, before the form useMemo, if we're working with classes/mobx proxies
  const [firstInitValue] = useState(() => initValue(config, init));
  const isWrappingMobxProxy = !isPlainObject(firstInitValue);
  // If they're using init.input, useMemo on it (and it might be an array), otherwise allow the identity of init be unstable
  const dep = isInput(init)
    ? init.onlyOnce
      ? []
      : makeArray(init.input)
    : isQuery(init)
      ? [init.query.data, init.query.loading]
      : [];

  const form = useMemo(
    () => {
      function maybeAutoSave() {
        if (isAutoSaving === "in-flight") {
          pendingAutoSave = true;
        } else if (isAutoSaving === "queued") {
          // If we've queued up an auto-save, that means we haven't called the `autoSave(...)` function yet, so
          // we assume that the scheduled-but-not-yet-invoked invocation will find both it's original change, and
          // also this potentially new change, and put them both onto the wire as a single operation.
          // So we can just ignore this call.
          return;
        }

        // Don't use canSave() because we don't want to set touched for all the fields
        if (autoSaveRef.current && form.dirty && !isAutoSaving) {
          // It's very frustrating to not know why the form is savings, to go ahead and log these
          if (!form.valid) {
            console.debug("Skipping auto-save b/c form is invalid: ", form.errors);
            return;
          }
          isAutoSaving = "queued";
          let maybeError: undefined | string;
          // We use setTimeout as a cheap way to wait until the end of the current event listener
          setTimeout(async () => {
            try {
              // Tell commitChanges to blow up.
              (form as any)._isAutoSaving = true;
              // We technically don't flip to in-flight until after the call in case the
              // user's autoSave function itself wants to call a .set (which would call `maybeAutoSave`,
              // and we don't want it to see `isAutoSaving=in-flight` and think it "missed the boat",
              // and so schedule an unnecessary follow-up autosave.)
              const promise = autoSaveRef.current!(form);
              isAutoSaving = "in-flight";
              await promise;
            } catch (e) {
              maybeError = String(e);
              throw e;
            } finally {
              isAutoSaving = false;
              (form as any)._isAutoSaving = false;
              if (pendingAutoSave) {
                pendingAutoSave = false;
                // Push out the follow-up by 1 tick to allow refreshes to happen to potentially
                // un-dirty the just-saved data (e.g. if we run right away, the caller's maybeAutoSave
                // will see a form.changedValue that thinks the just-saved data is still dirty).
                setTimeout(maybeAutoSave, 0);
              }
            }
          }, 0);
        }
      }
      const value = firstRunRef.current ? firstInitValue : initValue(config, init);
      const form = createObjectState(config, value, { maybeAutoSave });
      form.readOnly = readOnly;
      setLoading(form, opts);
      // The identity of `addRules` is not stable, but assume that it is for better UX.
      (addRules || (() => {}))(form);
      firstRunRef.current = true;
      return form;
    },
    // For this useMemo, we (almost) never re-run so that we can have a stable `form` identity across query refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config, ...(isWrappingMobxProxy ? dep : [])],
  );

  // We use useEffect so that any mutations to the proxies, which will call `setState`s on any observers to
  // queue their components' render), don't happen during our render, per https://fb.me/setstate-in-render.
  useEffect(() => {
    // Ignore the 1st run b/c our 1st useMemo already initialized `form` with the current `init` value.
    // Also for mobx proxies, we recreate a new form-state every time init changes, so that our
    // fields fundamentally pointing to the right proxy. So just defer to the ^ useMemo.
    if (firstRunRef.current || isWrappingMobxProxy) {
      firstRunRef.current = false;
      return;
    }
    setLoading(form, opts);
    // Note: maybe someday we want to watch the `id` value and notice if it's changing (i.e. 2 -> 3),
    // and treat this more as a reset than a refresh, b/c the id changing means it's probably
    // not "the cache refreshed after a mutation save" but "the cache changed b/c of changing
    // rows in the table that our side panel's form has open/is focused on" (which ideally would
    // be treated as a full component remount by having an `key` field somewhere in the parent
    // component, but it's unlikely the user will always remember to do this).
    (form as any).set(initValue(config, init), { refreshing: true });
  }, [form, ...dep]);

  // Use useEffect so that we don't touch the form.init proxy during a render
  useEffect(() => {
    form.readOnly = readOnly;
    if (loading !== undefined) {
      form.loading = loading;
    }
  }, [form, readOnly, loading]);

  return form;
}

function setLoading(form: ObjectState<any>, opts: UseFormStateOpts<any, any>) {
  const { loading, init } = opts;
  if (loading !== undefined) {
    // Prefer the explicit/top-level opts.loading if it's set
    form.loading = loading;
  } else if (isInput(init) && !init.ifUndefined) {
    // Otherwise, check for `init.input`
    form.loading = init.input === undefined;
  } else if (isQuery(init)) {
    // Or `query.loading`
    form.loading = init.query.loading;
  }
}

function makeArray(input: any): any[] {
  return Array.isArray(input) ? input : [input];
}
