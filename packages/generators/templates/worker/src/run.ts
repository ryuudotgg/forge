export async function run() {
  // Put the work this service performs here. It runs on every POST /run,
  // so keep it idempotent: a trigger can arrive twice.
  await Promise.resolve();
}
