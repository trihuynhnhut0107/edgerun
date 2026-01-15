# Full Flow Curl Test Guide

This document provides a step-by-step guide to testing the full flow of the EdgeRun system using `curl`.

## Prerequisites

- Ensure the server is running (default: `http://localhost:3000`).
- Base URL: `BS=http://localhost:3000/api`

## Automatic Matching Behavior

The matching engine runs automatically in the following scenarios:

- **New Order Created**: When a new order is created, the system automatically runs matching to find suitable drivers
- **Driver Status Changed**: When a driver's status changes to "available", matching runs to assign pending orders
- **Assignment Rejected**: When a driver rejects an assignment, the system automatically tries to reassign to another driver

You no longer need to manually trigger the matching endpoint in normal workflows. The manual trigger is still available for testing and debugging purposes.

## 1. Create Customers

Create customers who will place orders.

**Customer 1 (Chelsea area):**

```bash
curl -X POST $BS/customers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alice Johnson",
    "email": "alice@example.com",
    "phone": "+12125551001",
    "defaultAddress": "Chelsea Market, Manhattan",
    "defaultLocation": {
      "lat": 40.7465,
      "lng": -74.0014
    }
  }'
```

**Customer 2 (Upper West Side):**

```bash
curl -X POST $BS/customers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Bob Smith",
    "email": "bob@example.com",
    "phone": "+12125551002",
    "defaultAddress": "Upper West Side, Manhattan",
    "defaultLocation": {
      "lat": 40.7870,
      "lng": -73.9754
    }
  }'
```

**Customer 3 (Midtown):**

```bash
curl -X POST $BS/customers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Carol Davis",
    "email": "carol@example.com",
    "phone": "+12125551003",
    "defaultAddress": "Midtown Manhattan",
    "defaultLocation": {
      "lat": 40.7580,
      "lng": -73.9855
    }
  }'
```

**Customer 4 (SoHo):**

```bash
curl -X POST $BS/customers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "David Wilson",
    "email": "david@example.com",
    "phone": "+12125551004",
    "defaultAddress": "SoHo, Manhattan",
    "defaultLocation": {
      "lat": 40.7233,
      "lng": -74.0030
    }
  }'
```

**Save the customer IDs from responses for order creation.**

## 2. Create Drivers

Create drivers who will be available to take orders.

**Driver 1 (Manhattan Bike Courier):**

```bash
curl -X POST $BS/drivers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Manhattan Driver",
    "phone": "+12125550199",
    "vehicleType": "bike",
    "maxOrders": 2,
    "initialLocation": {
      "lat": 40.7580,
      "lng": -73.9855
    }
  }'
```

**Driver 2 (Additional Driver - Optional for multi-driver testing):**

```bash
curl -X POST $BS/drivers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Downtown Driver",
    "phone": "+12125550198",
    "vehicleType": "car",
    "maxOrders": 3,
    "initialLocation": {
      "lat": 40.7200,
      "lng": -74.0000
    }
  }'
```

**Save the `id` from the responses as `DRIVER_ID_1` and `DRIVER_ID_2`.**

## 3. Update Driver Locations

Simulate the drivers moving or confirming their locations.

**Driver 1 Location Update (Midtown):**

```bash
# Replace :driverId with DRIVER_ID_1
curl -X POST $BS/drivers/:driverId/location \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 40.7580,
    "lng": -73.9855,
    "heading": 0,
    "speed": 0
  }'
```

**Driver 2 Location Update (Optional):**

```bash
# Replace :driverId with DRIVER_ID_2
curl -X POST $BS/drivers/:driverId/location \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 40.7200,
    "lng": -74.0000,
    "heading": 90,
    "speed": 0
  }'
```

## 4. Set Driver Status to Available

The drivers must be `available` to receive assignments.

**Set Driver 1 to Available:**

```bash
# Replace :driverId with DRIVER_ID_1
curl -X PATCH $BS/drivers/:driverId/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "available"
  }'
```

**Set Driver 2 to Available (Optional):**

```bash
# Replace :driverId with DRIVER_ID_2
curl -X PATCH $BS/drivers/:driverId/status \
  -H "Content-Type: application/json" \
  -d '{
    "status": "available"
  }'
```

## 5. Create Orders

Create a few orders in the vicinity (Chelsea to West Village, UWS to UES).

**Order 1 (Chelsea to West Village):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7465,
      "lng": -74.0014
    },
    "pickupAddress": "Chelsea Market, Manhattan",
    "dropoffLocation": {
      "lat": 40.7358,
      "lng": -74.0036
    },
    "dropoffAddress": "West Village, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "afternoon",
    "priority": 5
  }'
```

**Order 2 (Upper West to Upper East):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7870,
      "lng": -73.9754
    },
    "pickupAddress": "Upper West Side, Manhattan",
    "dropoffLocation": {
      "lat": 40.7736,
      "lng": -73.9566
    },
    "dropoffAddress": "Upper East Side, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "afternoon",
    "priority": 5
  }'
```

**Order 3 (Midtown to Times Square - Morning, High Priority):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7580,
      "lng": -73.9855
    },
    "pickupAddress": "Midtown Manhattan",
    "dropoffLocation": {
      "lat": 40.7589,
      "lng": -73.9851
    },
    "dropoffAddress": "Times Square, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "morning",
    "priority": 8
  }'
```

**Order 4 (SoHo to Tribeca - Evening, Flexible):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7233,
      "lng": -74.0030
    },
    "pickupAddress": "SoHo, Manhattan",
    "dropoffLocation": {
      "lat": 40.7163,
      "lng": -74.0086
    },
    "dropoffAddress": "Tribeca, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "evening",
    "priority": 3
  }'
```

## 6. Get Offered Assignments for Driver

**Note:** The matching engine now runs automatically when orders are created or driver status changes. You no longer need to manually trigger optimization.

Check what assignments the driver has been offered.

```bash
# Replace :driverId with DRIVER_ID_1
curl -X GET $BS/drivers/:driverId/assignments/offered
```

**Save the `assignmentId` from the response for the next steps.**

## 7. Accept Assignment

The driver accepts an assignment.

```bash
# Replace :assignmentId with an ID from step 6
curl -X POST $BS/drivers/assignments/:assignmentId/accept
```

## 8. Get Driver Route

Verify the driver's current route has the accepted assignment.

```bash
# Replace :driverId with DRIVER_ID_1
curl -X GET $BS/drivers/:driverId/route
```

## 9. (Optional) Reject Assignment

If you want to test rejection logic (instead of step 7).

```bash
# Replace :assignmentId with an ID from step 6
curl -X POST $BS/drivers/assignments/:assignmentId/reject \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Too far"
  }'
```

After rejecting, the matching engine will automatically reassign the rejected order to another available driver.

## 10. Create Additional Orders After Driver Acceptance (Algorithm Testing)

Once a driver has accepted orders, create more orders to test the matching algorithm's ability to optimize routes with existing assignments. The matching engine will automatically run and optimize assignments.

**Order 5 (Near driver's current route - Midtown to Central Park):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7614,
      "lng": -73.9776
    },
    "pickupAddress": "Midtown East, Manhattan",
    "dropoffLocation": {
      "lat": 40.7829,
      "lng": -73.9654
    },
    "dropoffAddress": "Central Park, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "afternoon",
    "priority": 6
  }'
```

**Order 6 (High priority rush order):**

```bash
curl -X POST $BS/orders \
  -H "Content-Type: application/json" \
  -d '{
    "pickupLocation": {
      "lat": 40.7489,
      "lng": -73.9680
    },
    "pickupAddress": "Murray Hill, Manhattan",
    "dropoffLocation": {
      "lat": 40.7614,
      "lng": -73.9776
    },
    "dropoffAddress": "Grand Central Terminal, Manhattan",
    "requestedDeliveryDate": "2026-01-10",
    "preferredTimeSlot": "morning",
    "priority": 9
  }'
```

## 11. Check Updated Assignments

After creating new orders, the matching algorithm automatically runs and optimizes assignments. Check the updated state:

```bash
# Check driver's new offered assignments
curl -X GET $BS/drivers/:driverId/assignments/offered

# Check driver's full route including new potential assignments
curl -X GET $BS/drivers/:driverId/route
```

## 12. Get Order Status

Check the status of any order to verify assignment state.

```bash
# Replace :orderId with any order ID
curl -X GET $BS/orders/:orderId
```

## 13. Get Customer Information

Verify customer details and associated orders.

```bash
# By customer ID
curl -X GET $BS/customers/:customerId

# By customer email
curl -X GET $BS/customers/email/alice@example.com
```

## Advanced Testing Scenarios

### Scenario 1: Multi-Driver Load Balancing

1. Create 2+ drivers (steps 2-4)
2. Create 10+ orders (step 5)
3. Check assignments (step 6) - matching runs automatically
4. Verify orders are distributed across drivers

### Scenario 2: Driver Rejection and Reassignment

1. Driver accepts assignment (step 7)
2. Driver rejects another assignment (step 9)
3. Check assignments - matching runs automatically after rejection
4. Verify rejected order is reassigned to another driver

### Scenario 3: Dynamic Order Addition

1. Driver accepts 2-3 orders (step 7)
2. Create new orders near driver's route (step 10)
3. Check assignments (step 11) - matching runs automatically
4. Verify algorithm optimizes route insertion

### Scenario 4: Capacity Testing

1. Create driver with maxOrders=3
2. Create 5 orders - matching runs automatically
3. Verify driver is only assigned up to capacity
4. Remaining orders should be offered or remain pending

## Bulk Operations (Optional)

### Accept All Assignments for Testing

```bash
curl -X POST $BS/matching/accept-all
```

This will automatically accept all offered assignments for all drivers.

### Reject All Assignments for Testing

```bash
curl -X POST $BS/matching/reject-all
```

This will automatically reject all offered assignments for all drivers.

## Manual Matching Trigger (Optional)

While the matching engine runs automatically, you can still manually trigger optimization for testing purposes:

```bash
# Add ?verbose=true for detailed waypoints
curl -X POST "$BS/matching/optimize?verbose=true"
```

This is useful for:

- Testing the matching algorithm without creating new orders
- Forcing a re-optimization after manual changes
- Debugging optimization behavior

## Health Check

Verify the matching engine is operational:

```bash
curl -X GET $BS/matching/health
```

## Expected Flow Summary

```
1. Create Customers (4 customers)
   ↓
2. Create Drivers (2 drivers)
   ↓
3. Update Driver Locations
   ↓
4. Set Drivers to Available
   ↓
5. Create Initial Orders (4 orders)
   ↓ Run matching orders endpoint
6. Get Offered Assignments
   ↓
7. Driver Accepts Some Assignments
   ↓
8. Get Driver Route (verify accepted orders)
   ↓
9. (Optional) Driver Rejects Assignment
   ↓ (Matching runs automatically after rejection)
10. Create Additional Orders (test algorithm)
   ↓ (Matching runs automatically)
11. Check Updated Assignments
   ↓
12. Get Order Status (verify assignments)
   ↓
13. Get Customer Information (verify data)
```

## Notes

- **Automatic Matching**: The matching engine runs automatically when orders are created or driver status changes. You no longer need to manually trigger optimization.
- Replace placeholder IDs (`:driverId`, `:orderId`, `:customerId`, `:assignmentId`) with actual values from API responses
- Save all IDs returned from POST requests for use in subsequent steps
- Customer emails must be unique
- Driver and customer phone numbers must be unique
- Orders require valid coordinates and addresses
