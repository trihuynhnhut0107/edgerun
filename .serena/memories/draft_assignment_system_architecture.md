# EdgeRun Draft Assignment System - Architecture Summary

## Current Architecture Overview

### Technology Stack
- **ORM**: TypeORM with PostgreSQL + PostGIS for geographic queries
- **Routing API**: Mapbox Directions API (no OSRM)
- **Framework**: Express.js + TypeScript
- **Database**: PostgreSQL with spatial extensions (SRID 4326)
- **Node Versions**: TypeORM 0.3.27, Express 5.1.0

---

## 1. Entity Structure

### OrderAssignment Entity
**Location**: `src/entities/OrderAssignment.ts`

**Key Fields**:
```
- id (UUID): Primary key
- orderId (UUID): Reference to Order (OneToOne, unique)
- driverId (UUID): Reference to Driver
- sequence (int): Position in driver's route (1-based)
- status (enum AssignmentStatus): OFFERED | ACCEPTED | REJECTED | EXPIRED | COMPLETED | CANCELLED
- offerExpiresAt (timestamp): Auto-rejection timeout (3 minutes default)
- rejectionReason (text): Driver's reason for rejection
- respondedAt (timestamp): When driver responded
- offerRound (int): Which draft cycle created this assignment
- estimatedPickup (timestamp): Pickup time before optimization
- estimatedDelivery (timestamp): Delivery time before optimization
- actualPickup (timestamp): When driver actually picked up
- actualDelivery (timestamp): When order was delivered
- assignedAt (CreateDateColumn): When assignment created
- updatedAt (UpdateDateColumn): Last update time
- timeWindow (JSONB): SAA-based time window optimization result with:
  - lowerBound, upperBound, expectedArrival
  - windowWidthSeconds, confidenceLevel, violationProbability
  - penaltyWidth, penaltyEarly, penaltyLate
  - calculationMethod, sampleCount, travelTimeStdDev, coefficientOfVariation

**Relationships**:
- OneToOne with Order (eager: true) → order
- ManyToOne with Driver → driver

**Indexes**: driverId, orderId (foreign keys)

---

### Order Entity
**Location**: `src/entities/Order.ts`

**Key Fields**:
```
- id (UUID): Primary key
- pickupLocation (geometry/Point): PostGIS point, SRID 4326
- pickupAddress (varchar 255): Human-readable pickup address
- dropoffLocation (geometry/Point): PostGIS point, SRID 4326
- dropoffAddress (varchar 255): Human-readable dropoff address
- requestedDeliveryDate (date): Customer's desired delivery date
- preferredTimeSlot (varchar 50): "morning" | "afternoon" | "evening" | null
- status (enum OrderStatus): PENDING | OFFERED | ASSIGNED | PICKED_UP | DELIVERED | CANCELLED
- priority (int): 1-10 score, higher = more urgent
- value (float): Order value in dollars
- rejectedDriverIds (text[]): Array of driver UUIDs who rejected this order
- rejectionCount (int): Total rejections
- priorityMultiplier (float): Increases with rejections (default: 1.0)
- createdAt, updatedAt: Timestamp tracking

**Methods**:
- getPriorityScore(): number → priority × priorityMultiplier

**Indexes**: status, requestedDeliveryDate, pickupLocation (spatial), dropoffLocation (spatial)

---

### Driver Entity
**Location**: `src/entities/Driver.ts`

**Key Fields**:
```
- id (UUID): Primary key
- name (varchar 255): Driver name
- phone (varchar 20): Unique phone identifier
- vehicleType (varchar 50): "bike" | "scooter" | "car"
- maxOrders (int): Maximum orders per shift (default: 3)
- status (enum DriverStatus): OFFLINE | AVAILABLE | EN_ROUTE_PICKUP | AT_PICKUP | EN_ROUTE_DELIVERY | AT_DELIVERY
- createdAt, updatedAt: Timestamp tracking

**Relationships**:
- OneToMany with DriverLocation → locations
- OneToMany with OrderAssignment → assignments

---

### DriverLocation Entity
**Location**: `src/entities/DriverLocation.ts`

**Key Fields**:
```
- id (UUID): Primary key
- driverId (UUID): Foreign key
- location (geometry/Point): PostGIS point, SRID 4326
- heading (float): Direction in degrees (0-360)
- speed (float): Speed in km/h
- timestamp (CreateDateColumn): When location was recorded

**Indexes**: driverId+timestamp, driverId, location (spatial)

---

## 2. Matching Engine Implementation

### Location**: `src/services/matching/matchingEngine.ts` (1600+ lines)

### Key Interfaces & Types

```typescript
interface Sector {
  driverId: string;
  orders: Order[];
  driver: Driver;
  driverLocation: Location;
}

interface Stop {
  orderId: string;
  type: "pickup" | "delivery";
  location: Location;
  sequenceIndex: number;
  cumulativeDistance: number;
  cumulativeTime: number;
}

interface OptimizedRoute {
  driverId: string;
  driverName: string;
  orders: Order[];
  sequence: Location[]; // All stops in order
  stops: Stop[]; // Metadata for VRPPD support
  totalDistance: number; // meters
  metrics: { orderCount, distancePerOrder }
  timeWindows?: (TimeWindowData | null)[]; // SAA-based
}

interface DraftResult {
  orderId: string;
  driverId: string;
  insertionCost: number;
  estimatedPickup: Date;
  estimatedDelivery: Date;
  sequence: number;
  priorityScore: number;
}

interface InsertionResult {
  cost: number; // Distance increase
  pickupIndex: number;
  deliveryIndex: number;
  pickupTime: Date;
  deliveryTime: Date;
  newTotalDistance: number;
}
```

### 5-Stage Pipeline

**STAGE 0: Region Splitting (PostGIS)**
- Function: `RegionService.groupByRegion()`
- Uses ST_ClusterDBSCAN for density-based spatial clustering
- Groups orders into geographic clusters with centroids
- Assigns drivers to regions based on proximity (default: 50km radius)
- Fallback to haversine-based clustering if PostGIS fails

**STAGE 1: Territory Sectorization**
- Function: `sectorizeOrders(orders, driversWithLocation)`
- Assigns each pending order to nearest available driver
- Filters by driver capacity (maxOrders)
- Uses Mapbox for accurate routing distance (not haversine)
- Time Complexity: O(n × m) where n=orders, m=drivers

**STAGE 2: Route Optimization** 
- **Stage 3a**: Nearest Neighbor algorithm
  - Function: `nearestNeighbor(orders, startLocation)`
  - Greedy approach: start at driver location, add nearest unvisited order
  - Time Complexity: O(n²)
  - Quality: 70-80% of optimal
  - Uses Mapbox Directions API for actual road distances

- **Stage 3b**: 2-Opt Local Search
  - Function: `twoOpt(route, maxIterations=10)`
  - Iteratively improves route by reversing segments
  - Time Complexity: O(n² × iterations)
  - Improvement: 10-20% distance reduction
  - Max iterations: 10 (configurable)

**STAGE 3: Time Window Generation (SAA-enhanced)**
- Function: `generateTimeWindowsForRoute(route)`
- For each stop in the sequence:
  - Calculate travel time using Mapbox API
  - Add service time (pickup=5min, delivery=3min)
  - Generate time window bounds using SAA if 30+ observations available
  - Calculate confidence scores (0-1)
  - Validate pickup-before-delivery precedence (VRPPD constraint)
- Returns TimeWindowData[] matching stops count
- Stores results in OrderAssignment.timeWindow (JSONB)

**STAGE 4: Persistence**
- Function: `saveAssignments(optimizedRoutes)`
- Creates OrderAssignment records for each order
- Uses OrderAssignmentService.assignOrder() for validation
- Updates Order status → ASSIGNED
- Updates Driver status (AVAILABLE → EN_ROUTE_PICKUP on first assignment)
- Handles individual errors gracefully with logging

### Draft → Offer → Wait → Process Workflow

**PHASE 1: DRAFT**
- Function: `draftBestAssignments(offerRound: number)`
- Uses RegionService for PostGIS-based region splitting
- Creates in-memory ScoredDraft objects with scoring:
  - Distance Score: Insertion cost normalized (max 50km)
  - Priority Score: Order priority (higher = better, inverted)
  - Time Window Score: Violation risk estimation
  - Confidence: Weighted combination (0-1)
- Records ALL driver-order combinations (not just best per order)
- Uses DraftMemory for efficient scoring and selection
- Returns DraftResult[] with top selections respecting driver capacity

**PHASE 2: OFFER**
- Function: `offerAssignments(drafts, offerRound)`
- Creates OrderAssignment records with status=OFFERED
- Sets offerExpiresAt = now + 3 minutes
- Does NOT update Order.status or Driver.status yet
- Persists all drafts to database for driver response

**PHASE 3: WAIT** (Testing mode)
- Function: `waitForResponses(waitTimeMs)`
- Waits for driver responses (default: 3 minutes)
- Skipped in auto-accept mode for testing

**PHASE 4: PROCESS**
- Function: `processResponses()`
- Auto-expires stale OFFERED assignments (>3 minutes old)
- Counts ACCEPTED vs REJECTED assignments
- Returns { accepted, rejected, expired }

**Main Matching Cycle**
- Function: `matchOrders(autoAccept=true)`
- Executes Draft → Offer → Auto-accept flow
- Auto-accept simulates driver confirmation (for testing)
- Builds OptimizedRoute[] response for API
- Returns routes grouped by driver with metrics

---

## 3. Draft Memory & Scoring

### Location**: `src/services/matching/DraftMemory.ts`

**Purpose**: In-memory temporary storage for route candidates during draft phase

**Key Class**: DraftMemory
```typescript
class DraftMemory {
  private drafts: Map<string, ScoredDraft[]>; // driverId -> candidates
  private selectedDrafts: ScoredDraft[];
  
  methods:
  - addDraft(driverId, draft): Score and store draft
  - scoreDraft(draft): Calculate multi-criteria score
  - selectBestDrafts(driverCapacities): Greedy selection with conflicts
  - getStats(): Return aggregate statistics
  - getDraftsForDriver(driverId): Get all drafts per driver
  - clear(): Reset for next iteration
}
```

**Scoring Algorithm**:
1. Distance Score (40% weight): Insertion cost / 50km (max 50000m)
2. Priority Score (30% weight): 1 - (orderPriority / 100) (inverted)
3. Time Window Score (30% weight): Violation risk (0-1)
   - Ideal delivery time: 15-30 minutes
   - Too short or too long = higher risk
4. Confidence = 1 - avgScore (0-1 range)
5. Total Score = distance×0.4 + priority×0.3 + timeWindow×0.3

**Selection Logic**:
- Collects all drafts from all drivers
- Sorts by total score (ascending = best first)
- Greedy selection: skip conflicts (order already assigned)
- Respects driver capacity (maxOrders per driver)
- Returns ScoredDraft[] with highest scores

---

## 4. Region Service (PostGIS Clustering)

### Location**: `src/services/matching/RegionService.ts`

**Purpose**: Geographic grouping for efficient spatial matching

**Key Function**: `RegionService.groupByRegion(orders, drivers, maxDistanceKm, minPointsPerCluster)`

**Algorithm**:
1. **Cluster Orders**: Uses PostGIS ST_ClusterDBSCAN
   - eps: maxDistanceKm × 1000 (default: 50km)
   - minpoints: minPointsPerCluster (default: 2)
   - Groups nearby orders into spatial clusters
   - Isolates outlier orders (cluster -1) → assign to own clusters

2. **Calculate Centroids**: ST_Centroid for each cluster
   - Geographic center of order group

3. **Assign Drivers**: Filter drivers within routable distance
   - Uses haversine distance to centroid
   - Only includes drivers within maxDistanceKm

4. **Create Regions**: Region objects with:
   - id: "region_0", "region_1", etc.
   - centroid: { lat, lng }
   - orders: Order[] in region
   - drivers: DriverWithLocation[] in region
   - radiusKm: maxDistanceKm

**Fallback**: Haversine-based clustering if PostGIS query fails

---

## 5. Assignment Service (Offer-Accept Lifecycle)

### Location**: `src/services/assignment/order-assignment.service.ts`

**Key Methods**:

1. **assignOrder(data: CreateAssignmentDTO)**
   - Creates ASSIGNED assignment directly
   - Validates: order is PENDING, not already assigned
   - Updates Order.status → ASSIGNED
   - Updates Driver.status: AVAILABLE → EN_ROUTE_PICKUP (if first order)
   - Used by Stage 4 persistence

2. **createOfferedAssignment(data, offerRound)**
   - Creates OFFERED assignment with 3-minute expiry
   - Does NOT update Order or Driver status
   - Prevents duplicate OFFERED per order per round
   - Used by Phase 2 (OFFER)

3. **acceptAssignment(assignmentId)**
   - Transitions OFFERED → ACCEPTED
   - Updates Order.status → ASSIGNED
   - Updates Driver.status (if AVAILABLE)
   - Uses transaction for atomicity

4. **expireStaleOffers()**
   - Auto-rejects offers expired >3 minutes
   - Marks as EXPIRED status

5. **getActiveAssignmentsForDriver(driverId)**
   - Returns assignments for calculating current route
   - Used for best insertion calculation

**TypeORM Pattern**:
- Uses manager.transaction() for atomic operations
- Respects cascade deletes (OrderAssignment → Order)
- Eager loading: Order with assignment

---

## 6. Mapbox Integration

### Location**: `src/services/routing/mapboxClient.ts`

**Key Functions**:

```typescript
// Routing calculations (actual road distances/times)
async getRoute(from, to, profile='driving-traffic'): RouteResult
async getDistance(from, to, profile): { distance_m, duration_s }
async getDrivingTime(from, to, profile): number (milliseconds)

// Geographic pre-filtering (fast haversine)
haversineDistance(from, to): number (meters)
isWithinRoutableDistance(from, to, maxDistanceKm): boolean

// Matrix API (batch distance calculations)
getDistanceMatrix(locations, profile): Promise<distance_matrix>
```

**Profile Types**: 'driving-traffic' | 'driving' | 'walking' | 'cycling'

**Usage Pattern**:
1. Pre-filter with haversine (fast, geographic)
2. Calculate actual routing distance with Mapbox (accurate, slower)
3. Use results for cost/insertion calculations

**Environment**: MAPBOX_ACCESS_TOKEN from .env

---

## 7. Status Enums

### Order Status Flow
```
PENDING
  ↓ (draft created)
OFFERED (optional, during draft phase)
  ↓ (driver accepts/offer expires)
ASSIGNED (driver confirmed)
  ↓ (arrives at pickup)
PICKED_UP
  ↓ (delivers package)
DELIVERED
  ↓ (cancellation)
CANCELLED (anytime)
```

### Assignment Status Flow
```
OFFERED (initial, awaiting driver response)
  ↓ (3-minute timeout)
EXPIRED (auto-rejected)
  ↓ or (driver rejects)
REJECTED (driver refused)
  ↓ or (driver accepts)
ACCEPTED (driver confirmed)
  ↓ (delivery complete)
COMPLETED
  ↓ or (order cancelled)
CANCELLED
```

### Driver Status Flow
```
OFFLINE (inactive)
  ↓ (driver goes online)
AVAILABLE (ready to pick up)
  ↓ (first assignment)
EN_ROUTE_PICKUP (heading to pickup)
  ↓ (arrives at pickup)
AT_PICKUP (at pickup location)
  ↓ (starts delivery)
EN_ROUTE_DELIVERY (heading to delivery)
  ↓ (arrives at delivery)
AT_DELIVERY (at delivery location)
```

---

## 8. Database & ORM Details

**Database**: PostgreSQL + PostGIS
- SRID 4326: WGS84 (lat/lng coordinates)
- Geometry types: Point for locations
- Custom functions: ST_ClusterDBSCAN, ST_Centroid, ST_DWithin, ST_Distance

**TypeORM Configuration**:
- Location: `src/config/ormconfig.ts`
- Synchronize: false (use migrations)
- Logging: enabled in development
- Entities: Driver, DriverLocation, Order, OrderAssignment, TimeWindow, RouteSegmentObservation

**Connection Env Variables**:
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=<password>
DB_NAME=edgerun_db
```

---

## 9. API Endpoints (Matching Controller)

**Location**: `src/controllers/matching/matching.controller.ts`

### POST /matching/optimize
- Executes complete matching pipeline (Draft → Offer → Auto-accept)
- Returns MatchingResponse with routes and metrics
- Query param: verbose (include detailed waypoints)

### POST /matching/draft
- Runs Phase 1 (DRAFT) only
- Returns DraftResult[] with all draft combinations

### POST /matching/process
- Runs Phase 4 (PROCESS)
- Expires stale offers, counts responses
- Returns { accepted, rejected, expired }

---

## 10. Key Algorithms & Complexity

| Operation | Algorithm | Complexity | Quality | Notes |
|-----------|-----------|-----------|---------|-------|
| Sectorization | Nearest Neighbor | O(n×m) | 100% | Greedy assignment |
| Route Optimization | Nearest Neighbor | O(n²) | 70-80% | Initial route |
| Route Improvement | 2-Opt | O(n²×iter) | 10-20% gain | Max 10 iterations |
| Time Windows | SAA-based | O(n) | 95%+ | With 30+ observations |
| Regional Clustering | ST_ClusterDBSCAN | O(n log n) | optimal | PostGIS native |
| Draft Scoring | Weighted scoring | O(d×log d) | 100% | Multi-criteria |
| Insertion Calculation | Best insertion | O(n²) | optimal | VRPPD-aware |

---

## 11. Current Draft Assignment Features

✅ **Implemented**:
- Region-based spatial filtering (PostGIS)
- Territory sectorization (Nearest Neighbor)
- Route optimization (Nearest Neighbor + 2-Opt)
- Time window generation (SAA-enhanced, VRPPD-aware)
- Offer lifecycle (OFFERED → ACCEPTED/REJECTED/EXPIRED)
- DraftMemory intelligent scoring
- Best insertion algorithm (respects VRPPD constraints)
- Driver capacity constraints
- Order priority and rejection tracking
- Multi-round matching with automatic offer expiry

⚠️ **To Implement**:
- GraphQL/REST API for accepting/rejecting offers
- WebSocket notifications for drivers
- Batch operations (accept multiple offers)
- Offer comparison interface (show alternatives)
- Time window visualization
- Driver acceptance rate analytics
- A/B testing framework for algorithm variants

---

## File Structure Summary

```
src/
├── entities/
│   ├── OrderAssignment.ts (165 lines)
│   ├── Order.ts (115 lines)
│   ├── Driver.ts (45 lines)
│   └── DriverLocation.ts (47 lines)
├── services/
│   ├── matching/
│   │   ├── matchingEngine.ts (1600+ lines)
│   │   ├── DraftMemory.ts (295 lines)
│   │   └── RegionService.ts (299 lines)
│   ├── assignment/
│   │   └── order-assignment.service.ts (300+ lines)
│   └── routing/
│       └── mapboxClient.ts (150+ lines)
├── controllers/
│   └── matching/
│       └── matching.controller.ts (150+ lines)
├── enums/
│   ├── AssignmentStatus.ts
│   ├── OrderStatus.ts
│   └── DriverStatus.ts
└── config/
    └── ormconfig.ts (28 lines)
```

---

## Testing & Validation

**Test Commands**:
```bash
npm run seed              # Populate test data
npm run test:matching    # Test matching engine
npm run test:geospatial  # Test PostGIS queries
npm run migration:run    # Apply migrations
```

**Key Test Files**:
- `src/utils/testMatching.ts`
- `src/services/matching/__tests__/matchingEngine.test.ts`

---

## Performance Characteristics

- **Sectorization**: ~100ms for 100 orders, 10 drivers
- **Route Optimization**: ~500ms for 20 orders/driver
- **Time Windows**: ~200ms per route (with Mapbox calls)
- **Total Matching**: ~2-3 seconds for 100 orders, 10 drivers
- **Mapbox API Calls**: ~O(n×m) for initial sectorization, ~O(n²) for optimization
- **Database Queries**: PostGIS clustering ~100ms for 1000 orders

---

## Dependencies & Versions

- TypeORM: 0.3.27
- Express: 5.1.0
- Mapbox SDK: 0.16.2
- PostgreSQL Driver: 8.16.3
- TypeScript: 5.9.3
- GeoJSON: 7946.0.16
