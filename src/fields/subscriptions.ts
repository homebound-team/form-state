type SubscriptionLifecycle = {
  active: boolean;
  activate(): void;
  deactivate(): void;
};

/**
 * Tracks reversible subscriptions to observable instances supplied by callers.
 *
 * In development, React StrictMode replays effects as setup -> cleanup -> setup while keeping the
 * same form instances. Cleanup must release external-store reactions so they cannot retain an
 * unmounted form or trigger autosave. Replayed setup must reconnect those reactions without
 * replacing the form, losing edits, or resetting acknowledgement state. Hooks therefore construct
 * inactive forms, activate them in effect setup, and deactivate them in cleanup. An abandoned
 * initial render never acquires subscriptions that would have no effect cleanup to release them.
 *
 * Only value fields wrapping external MobX observables own these reactions. Object and list fields
 * coordinate their children's subscriptions, including cached list rows. This lifecycle does not
 * manage form-state's own atoms, observable properties, or computed values.
 *
 * Demand-driven subscriptions would mean "autosave only while someone observes this field."
 * Our hooks instead mean "autosave while this hook owns the form," including cached fields that
 * no component observes. That is why these reactions follow the owning effect's lifecycle rather
 * than MobX's observer count.
 *
 * Keep lifecycle operations off the public field objects and exported form API. The WeakMap also
 * lets inactive forms be collected without requiring a separate registry cleanup.
 */
const subscriptions = new WeakMap<object, SubscriptionLifecycle>();

/** Registers a field's reversible subscription lifecycle, initially inactive. */
export function registerSubscriptions(state: object, lifecycle: Omit<SubscriptionLifecycle, "active">): void {
  subscriptions.set(state, { ...lifecycle, active: false });
}

/** Connects a field tree once, without replacing its values or acknowledgement state. */
export function activateSubscriptions(state: object): void {
  const lifecycle = subscriptions.get(state);
  if (lifecycle && !lifecycle.active) {
    lifecycle.active = true;
    lifecycle.activate();
  }
}

/** Disconnects a field tree synchronously; a later effect setup can reconnect it. */
export function deactivateSubscriptions(state: object): void {
  const lifecycle = subscriptions.get(state);
  if (lifecycle?.active) {
    lifecycle.active = false;
    lifecycle.deactivate();
  }
}

/** Reports whether this field tree currently owns active subscriptions. */
export function subscriptionsActive(state: object): boolean {
  return subscriptions.get(state)?.active ?? false;
}
