/**
 * Database Seeding Utility - Manhattan Only
 * Creates realistic test data for single-region testing
 *
 * Usage: npm run seed
 *
 * Creates:
 * - 20 customers (registered users)
 * - 10 drivers with total capacity 40 (4 orders each)
 * - 30 orders distributed across Manhattan neighborhoods (70% from registered customers, 30% anonymous)
 * - Ensures total driver capacity (40) > total orders (30)
 * - Tests algorithm with single region for debugging
 */

import 'reflect-metadata';
import { AppDataSource } from '../config/ormconfig';
import { driverService } from '../services/driver/driver.service';
import { customerService } from '../services/customer/customer.service';
import { orderService } from '../services/order/order.service';
import { DriverStatus } from '../enums/DriverStatus';
import { OrderStatus } from '../enums/OrderStatus';

/**
 * Manhattan neighborhoods (single region)
 * All locations within ~10km radius for efficient regional matching
 */
const MANHATTAN_NEIGHBORHOODS = {
  midtown: { lat: 40.7580, lng: -73.9855, name: 'Midtown Manhattan' },
  upperWest: { lat: 40.7870, lng: -73.9754, name: 'Upper West Side' },
  upperEast: { lat: 40.7736, lng: -73.9566, name: 'Upper East Side' },
  chelsea: { lat: 40.7465, lng: -74.0014, name: 'Chelsea' },
  westVillage: { lat: 40.7358, lng: -74.0036, name: 'West Village' },
  eastVillage: { lat: 40.7264, lng: -73.9818, name: 'East Village' },
  lowerEast: { lat: 40.7168, lng: -73.9861, name: 'Lower East Side' },
  tribeca: { lat: 40.7195, lng: -74.0089, name: 'Tribeca' },
  soho: { lat: 40.7233, lng: -74.0027, name: 'SoHo' },
  chinatown: { lat: 40.7155, lng: -73.9976, name: 'Chinatown' },
  financialDistrict: { lat: 40.7074, lng: -74.0113, name: 'Financial District' },
  gramercy: { lat: 40.7369, lng: -73.9844, name: 'Gramercy Park' },
};

const seedDatabase = async () => {
  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🌱 DATABASE SEEDING - Manhattan Only (Single Region)');
    console.log('═══════════════════════════════════════════════════════════\n');

    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✓ Database connection established');
    }

    // Clean up existing data before seeding
    console.log('🧹 Cleaning up existing data...');
    const existingDrivers = await driverService.getAllDrivers();
    const existingCustomers = await customerService.getAllCustomers();

    if (existingDrivers.length > 0 || existingCustomers.length > 0) {
      const driverRepo = AppDataSource.getRepository('Driver');
      const customerRepo = AppDataSource.getRepository('Customer');
      const orderRepo = AppDataSource.getRepository('Order');
      const assignmentRepo = AppDataSource.getRepository('OrderAssignment');
      const locationRepo = AppDataSource.getRepository('DriverLocation');
      const timeWindowRepo = AppDataSource.getRepository('TimeWindow');
      const observationRepo = AppDataSource.getRepository('RouteSegmentObservation');

      // Delete in order of foreign key dependencies
      const timeWindows = await timeWindowRepo.find();
      const assignments = await assignmentRepo.find();
      const orders = await orderRepo.find();
      const observations = await observationRepo.find();
      const locations = await locationRepo.find();

      if (timeWindows.length > 0) await timeWindowRepo.remove(timeWindows);
      if (assignments.length > 0) await assignmentRepo.remove(assignments);
      if (observations.length > 0) await observationRepo.remove(observations);
      if (locations.length > 0) await locationRepo.remove(locations);
      if (orders.length > 0) await orderRepo.remove(orders);
      if (existingDrivers.length > 0) await driverRepo.remove(existingDrivers);
      if (existingCustomers.length > 0) await customerRepo.remove(existingCustomers);

      console.log(`✓ Cleaned up:`);
      console.log(`  - ${existingCustomers.length} customers`);
      console.log(`  - ${existingDrivers.length} drivers`);
      console.log(`  - ${orders.length} orders`);
      console.log(`  - ${assignments.length} order assignments`);
      console.log(`  - ${timeWindows.length} time windows`);
      console.log(`  - ${observations.length} route observations`);
      console.log(`  - ${locations.length} driver locations\n`);
    } else {
      console.log('✓ Database is clean\n');
    }

    // ===================================================================
    // SEED CUSTOMERS (20 registered customers)
    // ===================================================================
    console.log('👥 Creating 20 customers...\n');

    const customerNames = [
      { first: 'John', last: 'Smith' },
      { first: 'Sarah', last: 'Johnson' },
      { first: 'Michael', last: 'Williams' },
      { first: 'Emily', last: 'Brown' },
      { first: 'Robert', last: 'Jones' },
      { first: 'Jennifer', last: 'Garcia' },
      { first: 'William', last: 'Miller' },
      { first: 'Linda', last: 'Davis' },
      { first: 'Richard', last: 'Rodriguez' },
      { first: 'Patricia', last: 'Martinez' },
      { first: 'Thomas', last: 'Hernandez' },
      { first: 'Barbara', last: 'Lopez' },
      { first: 'Daniel', last: 'Gonzalez' },
      { first: 'Nancy', last: 'Wilson' },
      { first: 'Joseph', last: 'Anderson' },
      { first: 'Margaret', last: 'Thomas' },
      { first: 'Christopher', last: 'Taylor' },
      { first: 'Lisa', last: 'Moore' },
      { first: 'Anthony', last: 'Jackson' },
      { first: 'Betty', last: 'Martin' },
    ];

    const customers = [];
    const neighborhoodKeys = Object.keys(MANHATTAN_NEIGHBORHOODS);

    for (let i = 0; i < customerNames.length; i++) {
      const { first, last } = customerNames[i];
      const neighborhoodKey = neighborhoodKeys[i % neighborhoodKeys.length];
      const neighborhood = MANHATTAN_NEIGHBORHOODS[neighborhoodKey as keyof typeof MANHATTAN_NEIGHBORHOODS];

      const customer = await customerService.createCustomer({
        name: `${first} ${last}`,
        email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
        phone: `+1${String(5551000 + i).padStart(10, '0')}`,
        defaultAddress: `${300 + i} ${neighborhood.name}, Manhattan, NY 10001`,
        defaultLocation: {
          lat: neighborhood.lat + (Math.random() - 0.5) * 0.003,
          lng: neighborhood.lng + (Math.random() - 0.5) * 0.003,
        },
      });

      customers.push(customer);

      if ((i + 1) % 5 === 0) {
        console.log(`  ✓ Created ${i + 1} customers...`);
      }
    }

    console.log(`\n  📊 Total customers: ${customers.length}`);

    // ===================================================================
    // SEED DRIVERS (10 drivers, 4 orders capacity each = 40 total)
    // ===================================================================
    console.log('\n📦 Creating 10 drivers in Manhattan...\n');

    const driverNames = [
      'Alex Rivera',
      'Maria Garcia',
      'James Chen',
      'Sofia Patel',
      'Marcus Thompson',
      'Elena Rodriguez',
      'David Park',
      'Jessica Williams',
      'Ahmed Hassan',
      'Emma Murphy',
    ];

    const vehicleTypes = ['car', 'scooter', 'bike'];
    const neighborhoods = Object.keys(MANHATTAN_NEIGHBORHOODS);
    let totalCapacity = 0;

    for (let i = 0; i < driverNames.length; i++) {
      const name = driverNames[i];
      const vehicleType = vehicleTypes[i % vehicleTypes.length];
      const maxOrders = 4; // All drivers have capacity of 4

      // Place driver in different neighborhoods
      const neighborhoodKey = neighborhoods[i % neighborhoods.length];
      const location = MANHATTAN_NEIGHBORHOODS[neighborhoodKey as keyof typeof MANHATTAN_NEIGHBORHOODS];

      const driver = await driverService.createDriver({
        name,
        phone: `+1${String(5550000 + i).slice(-7)}`,
        vehicleType,
        maxOrders,
        initialLocation: {
          lat: location.lat + (Math.random() - 0.5) * 0.003, // Small randomization within 300m
          lng: location.lng + (Math.random() - 0.5) * 0.003,
        },
      });

      // Update driver status to AVAILABLE for matching
      const driverRepo = AppDataSource.getRepository('Driver');
      driver.status = DriverStatus.AVAILABLE;
      await driverRepo.save(driver);

      totalCapacity += maxOrders;

      console.log(
        `  ✓ ${name.padEnd(20)} | ${vehicleType.padEnd(7)} | Capacity: ${maxOrders} | ${location.name}`
      );
    }

    console.log(`\n  📊 Total driver capacity: ${totalCapacity} orders`);

    // ===================================================================
    // SEED ORDERS (30 orders - less than total capacity of 40)
    // 70% linked to customers, 30% anonymous
    // ===================================================================
    console.log('\n📦 Creating 30 orders across Manhattan...\n');

    const neighborhoodList = Object.keys(MANHATTAN_NEIGHBORHOODS);
    let orderCount = 0;
    let customerOrderCount = 0;
    let anonymousOrderCount = 0;

    for (let i = 0; i < 30; i++) {
      // Pick random pickup and dropoff neighborhoods
      const pickupKey = neighborhoodList[i % neighborhoodList.length];
      const dropoffKey = neighborhoodList[(i + 3) % neighborhoodList.length]; // Different from pickup

      const pickupLocation = MANHATTAN_NEIGHBORHOODS[pickupKey as keyof typeof MANHATTAN_NEIGHBORHOODS];
      const dropoffLocation = MANHATTAN_NEIGHBORHOODS[dropoffKey as keyof typeof MANHATTAN_NEIGHBORHOODS];

      // Add randomization to create realistic spread (within 500m)
      const pickupLat = pickupLocation.lat + (Math.random() - 0.5) * 0.005;
      const pickupLng = pickupLocation.lng + (Math.random() - 0.5) * 0.005;
      const dropoffLat = dropoffLocation.lat + (Math.random() - 0.5) * 0.005;
      const dropoffLng = dropoffLocation.lng + (Math.random() - 0.5) * 0.005;

      // Create order using proper DTO structure
      const deliveryDate = new Date();
      deliveryDate.setHours(deliveryDate.getHours() + 2); // Delivery in 2 hours
      const timeSlots = ['morning', 'afternoon', 'evening'];

      // 70% of orders are from registered customers
      const isCustomerOrder = i < 21; // First 21 orders (70%) are from customers
      const customerId = isCustomerOrder ? customers[i % customers.length].id : undefined;

      const order = await orderService.createOrder({
        pickupLat,
        pickupLng,
        pickupAddress: `${100 + i} ${pickupLocation.name}, Manhattan, NY`,
        dropoffLat,
        dropoffLng,
        dropoffAddress: `${200 + i} ${dropoffLocation.name}, Manhattan, NY`,
        requestedDeliveryDate: deliveryDate,
        preferredTimeSlot: timeSlots[i % timeSlots.length],
        priority: Math.floor(Math.random() * 10) + 1, // Priority 1-10
        value: parseFloat((Math.random() * 50 + 10).toFixed(2)), // $10-$60
        customerId, // Link to customer if applicable
      });

      // Ensure order status is PENDING
      const orderRepo = AppDataSource.getRepository('Order');
      order.status = OrderStatus.PENDING;
      await orderRepo.save(order);

      orderCount++;
      if (isCustomerOrder) {
        customerOrderCount++;
      } else {
        anonymousOrderCount++;
      }

      if (orderCount % 10 === 0) {
        console.log(`  ✓ Created ${orderCount} orders...`);
      }
    }

    console.log(`\n  📊 Order breakdown:`);
    console.log(`     • Customer orders:   ${customerOrderCount}`);
    console.log(`     • Anonymous orders:  ${anonymousOrderCount}`);

    // ===================================================================
    // SUMMARY
    // ===================================================================
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('✓ Database seeding completed successfully!');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log('📊 Seed Summary:');
    console.log(`   • Region:          Manhattan, New York (single region)`);
    console.log(`   • Neighborhoods:   ${Object.keys(MANHATTAN_NEIGHBORHOODS).length} areas`);
    console.log(`   • Customers:       ${customers.length} registered users`);
    console.log(`   • Drivers:         10 drivers`);
    console.log(`   • Total capacity:  ${totalCapacity} orders (4 per driver)`);
    console.log(`   • Orders:          30 orders (PENDING)`);
    console.log(`     - Customer:      ${customerOrderCount} orders (70%)`);
    console.log(`     - Anonymous:     ${anonymousOrderCount} orders (30%)`);
    console.log(`   • Capacity check:  ✅ ${totalCapacity} capacity > 30 orders`);
    console.log(`   • Vehicle types:   car, scooter, bike`);
    console.log(`   • Distance cache:  ✅ Enabled (pickup→dropoff cached on order creation)`);
    console.log(`   • Ready for:       Draft mode testing\n`);
    console.log('💡 Next steps:');
    console.log('   1. Start the server:      npm run dev');
    console.log('   2. Test customer API:     POST /api/customers (register)');
    console.log('   3. Test order creation:   POST /api/orders (with customerId)');
    console.log('   4. Test matching:         POST /api/matching/optimize');
    console.log('   5. Verify results:        ALL 30 orders should be assigned');
    console.log('   6. Check distance cache:  Inspect distance_cache table\n');
    console.log('═══════════════════════════════════════════════════════════\n');

  } catch (error) {
    console.error('\n✗ Database seeding failed:', error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
};

seedDatabase();
