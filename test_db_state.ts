import { AppDataSource } from "./src/config/ormconfig";

async function main() {
  try {
    console.log("Initializing DB...");
    await AppDataSource.initialize();
    console.log("DB Initialized.");

    // Check table info
    console.log("--- Schema Info ---");
    const columns = await AppDataSource.query(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'orders' AND column_name = 'status';
    `);
    console.log("Status Column:", JSON.stringify(columns, null, 2));

    console.log("--- Data Dump ---");
    const rows = await AppDataSource.query(
      `SELECT id, status, "createdAt" FROM orders`
    );
    console.log("Rows:", JSON.stringify(rows, null, 2));

    // Check query match directly
    const matchCount = await AppDataSource.query(
      `SELECT count(*) FROM orders WHERE status = 'pending'`
    );
    console.log("Count where status = 'pending':", matchCount);

    // Check potential whitespace or casing
    const matchLike = await AppDataSource.query(
      `SELECT id, status FROM orders WHERE status::text ILIKE '%pending%'`
    );
    console.log("Rows like '%pending%':", JSON.stringify(matchLike, null, 2));
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main();
