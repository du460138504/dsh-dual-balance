/**
 * Host half of dsh-dual-balance.
 *
 * The whole feature is browser-side: the widget reads the DeepSeek account
 * balance through the account remote and the WorkBuddy credit through the
 * route dsh-workbuddy-connect already serves. Nothing needs a host service,
 * so `apply` is intentionally empty — this module exists because a profile
 * bundle is mounted through its patch entry.
 */

/** Stable plugin name; the bundle patch entry refers to the package, not this. */
export const name = "dsh-dual-balance";

/** No host services are required. */
export const inject = [];

/** Mount point with no host-side behaviour. */
export function apply() {}
