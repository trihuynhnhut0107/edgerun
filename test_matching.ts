import { AppDataSource } from "./src/config/ormconfig";
import { Order } from "./src/entities/Order";

async function main() {
  try {
    console.log("Initializing DB...");
    await AppDataSource.initialize();
    console.log("DB Initialized.");

    const orderRepo = AppDataSource.getRepository(Order);

    // Raw query
    const rawOrders = await orderRepo.query("SELECT id, status FROM orders");
    console.log("Raw Orders:", JSON.stringify(rawOrders, null, 2));

    // Check pending count raw
    const rawPending = await orderRepo.query(
      "SELECT count(*) FROM orders WHERE status = 'pending'"
    );
    console.log("Raw Pending Count (status='pending'):", rawPending);
  } catch (err) {
    console.error("Error:", err);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main();
