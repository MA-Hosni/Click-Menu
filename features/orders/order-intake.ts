import "server-only";

/** Only this exact server environment value opens public dine-in order intake. */
export function isDineInOrderIntakeEnabled(): boolean {
  return process.env.DINE_IN_ORDER_INTAKE_ENABLED === "true";
}
