export async function register() {
  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.NEXT_PHASE !== "phase-production-build"
  ) {
    const { assertConfiguration } = await import("./lib/config/runtime");
    assertConfiguration();
    const { appMode } = await import("./lib/config/runtime");
    if (appMode() !== "development") {
      const { assertApplicationDatabaseRole } = await import(
        "./lib/ops/database-role"
      );
      await assertApplicationDatabaseRole();
    }
  }
}
