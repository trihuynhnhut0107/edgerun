# matchOrders() Complete Flow Explanation

## Overview
`matchOrders()` is the main entry point that orchestrates the entire order-to-driver matching and route optimization process. It takes NO input parameters and returns optimized routes with time windows.

---

## Function Signature
```typescript
export async function matchOrders(): Promise<OptimizedRoute[]>
```

**Input:** None (queries database directly)
**Output:** Array of `OptimizedRoute[]` with assigned orders, sequences, and time windows

---

## STAGE 1: Data Collection
### Input
- No external input parameters
- Queries database directly

### Functions Called

#### 1.1 `getPendingOrders()`
**What it does:**
- Searches database for all orders with status = `PENDING`
- Sorts by priority (DESC) and creation date (ASC)

**Returns:** `Order[]` - List of all unassigned orders waiting for pickup

**Example Output:**
```
[
  { id: 'order-1', pickupLocation: {...}, dropoffLocation: {...}, ... },
  { id: 'order-2', pickupLocation: {...}, dropoffLocation: {...}, ... },
  ...
]
```

#### 1.2 `getAvailableDrivers()`
**What it does:**
- Searches database for drivers with status = `AVAILABLE`, `EN_ROUTE_PICKUP`, `AT_PICKUP`, `EN_ROUTE_DELIVERY`, `AT_DELIVERY`
- For each driver, gets their latest location from `driver_locations` table
- Extracts lat/lng from PostGIS Point geometry

**Returns:** `DriverWithLocation[]` - Array of drivers with their current locations

**Example Output:**
```
[
  {
    driver: { id: 'driver-1', name: 'John', maxOrders: 5, ... },
    location: { lat: 10.5, lng: 106.5 }
  },
  {
    driver: { id: 'driver-2', name: 'Jane', maxOrders: 5, ... },
    location: { lat: 10.6, lng: 106.6 }
  },
  ...
]
```

### Validation
- Check if `pendingOrders.length > 0` and `driversWithLocation.length > 0`
- If either is empty, return `[]` and stop

---

## STAGE 2: Territory Sectorization
### Input
- `pendingOrders`: Array of all pending orders
- `driversWithLocation`: Array of available drivers with locations

### Function Called

#### 2.1 `sectorizeOrders(pendingOrders, driversWithLocation)`
**What it does:**
- For each pending order, finds the nearest available driver using OSRM distance
- Assigns order to nearest driver (if driver has capacity remaining)
- Groups orders by assigned driver

**Inner Process for Each Order:**
```
For order X:
  1. Get pickup location from order.pickupLocation.coordinates
  2. For each available driver:
     a. Call getDistance(driverLocation, orderPickupLocation)
     b. OSRM API returns distance_m between them
  3. Find driver with minimum distance
  4. Check if driver has remaining capacity (assigned_count < maxOrders)
  5. If yes, assign order to that driver
  6. If no, warn and skip this order
```

**Returns:** `Sector[]` - Orders grouped by assigned driver

**Example Output:**
```
[
  {
    driverId: 'driver-1',
    driver: { id: 'driver-1', name: 'John', ... },
    driverLocation: { lat: 10.5, lng: 106.5 },
    orders: [
      { id: 'order-1', ... },
      { id: 'order-5', ... },
      { id: 'order-8', ... }
    ]
  },
  {
    driverId: 'driver-2',
    driver: { id: 'driver-2', name: 'Jane', ... },
    driverLocation: { lat: 10.6, lng: 106.6 },
    orders: [
      { id: 'order-2', ... },
      { id: 'order-3', ... }
    ]
  }
]
```

---

## STAGE 3: Route Optimization
### Input
- `sectors`: Orders grouped by driver

### Function Called

#### 3.1 `optimizeAllRoutes(sectors)`
**What it does:**
- For each driver's sector (orders), generates optimal delivery sequence
- Uses two algorithms: Nearest Neighbor + 2-Opt improvement

**Inner Process for Each Sector:**

##### Step A: Initial Route Generation (Nearest Neighbor)
**Function: `nearestNeighbor(orders, startLocation)`**

```
Input: orders = [order-1, order-5, order-8], startLocation = driver location

Process:
1. Initialize route = [driver_location]
2. Mark all orders as unvisited
3. current_location = driver_location

Loop while unvisited orders exist:
  For each unvisited order:
    a. Get order.pickupLocation coordinates
    b. Call getDistance(current_location, orderPickupLocation)
    c. Track minimum distance order

  4. Add nearest order's pickup location to route
  5. Mark order as visited
  6. current_location = nearest order's pickup location

7. Add driver_location back (complete circuit: start → orders → end)

Returns: Location[] = [driver_loc, pickup1, pickup2, pickup3, driver_loc]
```

**Example Output:**
```
Route sequence for Driver-1:
[
  { lat: 10.5, lng: 106.5 },      // Depot (start)
  { lat: 10.52, lng: 106.51 },    // Pickup 1 (nearest)
  { lat: 10.55, lng: 106.55 },    // Pickup 2
  { lat: 10.58, lng: 106.58 },    // Pickup 3
  { lat: 10.5, lng: 106.5 }       // Depot (end)
]
```

##### Step B: Route Improvement (2-Opt)
**Function: `twoOpt(route, maxIterations=10)`**

```
Input: route from nearestNeighbor

Process:
For up to 10 iterations:
  For each pair of edges (i, j) in the route:
    a. Calculate current distance: dist(edge[i-1]→edge[i]) + dist(edge[j]→edge[j+1])
    b. Calculate new distance if we swap: dist(edge[i-1]→edge[j]) + dist(edge[i]→edge[j+1])
    c. If new distance < current distance:
       - Reverse the segment between i and j
       - Mark as improved and continue to next iteration

Returns: Improved Location[] sequence with shorter total distance
```

##### Step C: Calculate Route Metrics
**Function: `calculateRouteTotalDistance(route)`**

```
Input: optimized route sequence

Process:
For each consecutive pair of locations in route:
  Call getDistance(location[i], location[i+1])
  Sum all distances

Returns: total_distance_m
```

##### Step D: Build Stops Array (for VRPPD)
```
For each location in route (except first and last):
  1. Find matching order by coordinates
  2. Create Stop object with:
     - orderId
     - type: 'pickup'  (currently all pickups, future will include deliveries)
     - location
     - sequenceIndex (position in route)
     - cumulativeDistance (sum of distances from start)
     - cumulativeTime (cumulative time at this stop)
```

**Returns:** `OptimizedRoute[]`

**Example Output:**
```
{
  driverId: 'driver-1',
  driverName: 'John',
  orders: [order-1, order-5, order-8],
  sequence: [depot, pickup1, pickup2, pickup3, depot],
  stops: [
    {
      orderId: 'order-1',
      type: 'pickup',
      location: { lat: 10.52, lng: 106.51 },
      sequenceIndex: 1,
      cumulativeDistance: 3500,  // 3.5km from depot
      cumulativeTime: 6.7        // ~7 minutes
    },
    {
      orderId: 'order-5',
      type: 'pickup',
      location: { lat: 10.55, lng: 106.55 },
      sequenceIndex: 2,
      cumulativeDistance: 8200,
      cumulativeTime: 19.5
    },
    // ...
  ],
  totalDistance: 25600,  // meters
  metrics: {
    orderCount: 3,
    distancePerOrder: 8533
  }
}
```

---

## STAGE 4: Time Window Generation
### Input
- `optimizedRoutes`: Routes with sequences

### Function Called

#### 4.1 `generateTimeWindowsForRoute(route)`
**What it does:**
- For each stop in sequence, calculates expected arrival time including:
  - Travel time from previous location
  - Service time at previous location
  - Cumulative time from start of route

**Inner Process:**

```typescript
Input: One OptimizedRoute with stop sequence

Initialize:
  cumulativeTime = now()  // Current time as starting point
  cumulativeDistance = 0

For EACH STOP in sequence (including current):
  1. Get previousLocation = previous stop's location (or depot if first)
  2. Get currentLocation = current stop's location

  3. Call getDistance(previousLocation, currentLocation)
     Returns: { distance_m, duration_s }

  4. Calculate travelTimeMinutes = (distance_m / 1000) / (35 km/h) * 60
     (Average urban speed: 35 km/h)

  5. Calculate serviceTimeMinutes:
     - If pickup: 5 minutes
     - If delivery: 3 minutes

  6. Update cumulativeTime:
     cumulativeTime += (travelTimeMinutes + serviceTimeMinutes)

  7. Call timeWindowCalculator.calculateTimeWindow(cumulativeTime, params)
     Returns: {
       lowerBound: Date,
       upperBound: Date,
       expectedArrival: Date,
       windowWidthSeconds: number,
       confidenceLevel: number,
       violationProbability: number
     }

  8. Store in timeWindowData
```

**Returns:** `(TimeWindowData | null)[]` - Array of time windows aligned with stops

**Example Output for Order Sequence:**
```
Driver John's Route Start: 10:00 AM

Stop 1 - Order 1 Pickup:
  - Travel from depot (0 km): 0 minutes
  - Service time: 5 minutes
  - Expected arrival: 10:05 AM
  - Window: [10:00 AM - 10:10 AM]

Stop 2 - Order 5 Pickup:
  - Travel from prev (4.7 km at 35 km/h): 8 minutes
  - Service time: 5 minutes
  - Expected arrival: 10:18 AM (10:05 + 8 + 5)
  - Window: [10:10 AM - 10:25 AM]

Stop 3 - Order 8 Pickup:
  - Travel from prev (5.6 km at 35 km/h): 9.6 minutes
  - Service time: 5 minutes
  - Expected arrival: 10:32.6 AM (10:18 + 9.6 + 5)
  - Window: [10:25 AM - 10:40 AM]
```

---

## STAGE 5: Persistence - Save Assignments
### Input
- `optimizedRoutes`: Routes with time windows

### Function Called

#### 5.1 `saveAssignments(optimizedRoutes)`
**What it does:**
- Creates `OrderAssignment` records for each order
- Updates order status from `PENDING` → `ASSIGNED`
- Stores estimated pickup/delivery times

**Inner Process for Each Order:**

```typescript
For each route in optimizedRoutes:
  For each order in route:
    1. Get time window for this order (route.timeWindows[i])

    2. Extract estimated times:
       - estimatedPickup = timeWindowData.expectedArrival
         (includes cumulative travel from depot through all previous orders)
       - estimatedDelivery = timeWindowData.upperBound + 3 minutes
         (5-minute service at pickup + 3-minute delivery buffer)

    3. Call orderAssignmentService.assignOrder({
         orderId: order.id,
         driverId: route.driverId,
         sequence: order's position in route (1, 2, 3...),
         estimatedPickup,
         estimatedDelivery,
         timeWindow: timeWindowData
       })

    4. Service handles:
       - Database INSERT into OrderAssignment table
       - UPDATE order.status = ASSIGNED
       - Validation (order exists, not already assigned, etc.)
```

**Returns:** Number of assignments saved

**Example Database Record:**
```
OrderAssignment {
  id: 'assign-123',
  orderId: 'order-1',
  driverId: 'driver-1',
  sequence: 1,
  estimatedPickup: 2024-01-15 10:05:00,
  estimatedDelivery: 2024-01-15 10:08:00,
  status: 'ASSIGNED',
  createdAt: 2024-01-15 09:55:00
}
```

---

## STAGE 6: Summary & Return
### Output Processing

```typescript
For each optimizedRoute:
  Print: "{Driver Name}: {order count} orders, {distance}m"
  Accumulate total distance

Print: "TOTAL DISTANCE: {totalDistance}m"

Return: OptimizedRoute[]
```

---

## Complete Data Flow Diagram

```
INPUT: Database Queries
    ↓
    ├─→ getPendingOrders() → pendingOrders[]
    ├─→ getAvailableDrivers() → driversWithLocation[]
    ↓
STAGE 1: Data Collection
    ↓
[pendingOrders, driversWithLocation]
    ↓
    ├─→ sectorizeOrders()
    │   ├─→ For each order: getDistance(driver, order) [OSRM]
    │   ├─→ Find nearest driver
    │   └─→ Return: sectors (orders grouped by driver)
    ↓
STAGE 2: Territory Assignment
    ↓
[sectors]
    ↓
    ├─→ optimizeAllRoutes()
    │   ├─→ For each sector:
    │   │   ├─→ nearestNeighbor(orders, start)
    │   │   │   ├─→ For each unvisited: getDistance() [OSRM]
    │   │   │   └─→ Build sequence: [depot, pickup1, pickup2, depot]
    │   │   ├─→ twoOpt(route)
    │   │   │   ├─→ For each edge pair: getDistance() [OSRM]
    │   │   │   └─→ Swap if improves
    │   │   ├─→ calculateRouteTotalDistance()
    │   │   │   └─→ Sum all segments via getDistance() [OSRM]
    │   │   └─→ Build stops array (sequence metadata)
    │   └─→ Return: optimizedRoutes
    ↓
STAGE 3: Route Optimization
    ↓
[optimizedRoutes]
    ↓
    ├─→ For each route: generateTimeWindowsForRoute()
    │   ├─→ For each stop in sequence:
    │   │   ├─→ getDistance(prev, current) [OSRM]
    │   │   ├─→ Calculate cumulative time
    │   │   └─→ Calculate time window
    │   └─→ Attach timeWindows[] to route
    ↓
STAGE 4: Time Window Calculation
    ↓
[optimizedRoutes with timeWindows]
    ↓
    ├─→ saveAssignments()
    │   ├─→ For each order:
    │   │   ├─→ Extract estimatedPickup from time window
    │   │   ├─→ Calculate estimatedDelivery
    │   │   └─→ INSERT OrderAssignment record
    │   └─→ Return: assignmentCount
    ↓
STAGE 5: Database Persistence
    ↓
OUTPUT: OptimizedRoute[]
    ↓
Print Summary & Return
```

---

## Key Points Summary

| Stage | Input | Process | Output |
|-------|-------|---------|--------|
| 1 | DB | Query pending orders & available drivers | pendingOrders[], driversWithLocation[] |
| 2 | Orders + Drivers | Find nearest driver for each order (OSRM) | Sectors (orders grouped by driver) |
| 3 | Sectors | Optimize sequence per driver (NN + 2-Opt + OSRM) | OptimizedRoutes with sequences |
| 4 | Routes | Calculate cumulative times for each stop | TimeWindows[] with expectedArrival |
| 5 | Routes + Times | Save to DB with estimated times | OrderAssignment records |
| 6 | - | Print summary | Return OptimizedRoute[] |

---

## Important Details

### Time Calculation Inheritance
```
Each order's estimatedPickup = previous order's delivery time + travel time
Example:
  Order 1 pickup: 10:05 (from depot)
  Order 1 delivery: 10:08
  Order 2 pickup: 10:08 + 8min travel + 5min service = 10:21 ✅
  Order 2 delivery: 10:24
  Order 3 pickup: 10:24 + 12min travel + 5min service = 10:41 ✅
```

### OSRM Calls (with PostGIS fallback)
- Used in: sectorization, nearestNeighbor, 2-Opt, distance calculation, time window generation
- Total calls can be VERY HIGH for large datasets
- **Now includes fallback to PostGIS ST_Distance if OSRM fails**

### Distance Caching
- OSRM internally caches results within same session
- PostGIS fallback avoids expensive API calls if OSRM unavailable

---
