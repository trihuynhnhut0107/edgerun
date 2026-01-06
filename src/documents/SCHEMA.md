# EdgeRun Database Schema

Complete database schema documentation for the EdgeRun delivery optimization system.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Entity Relationships](#entity-relationships)
3. [Entities](#entities)
4. [Data Flow](#data-flow)
5. [Constraints & Indexes](#constraints--indexes)
6. [Design Decisions](#design-decisions)

---

## Overview

The EdgeRun schema is designed to support a multi-stage delivery route optimization system with time window generation based on research-backed algorithms.

### Key Principles

- **Minimal Input**: Orders store only customer-provided data (locations + requested delivery date)
- **Computed Output**: Time windows, assignments, and optimizations are calculated, not stored as input
- **Historical Learning**: RouteSegmentObservation enables data-driven time window optimization
- **Separation of Concerns**: Each entity has a single clear purpose

### Evolution Path

```
Stage 1: Order Entry (Customer provides: locations + requestedDeliveryDate)
   ↓
Stage 2: Route Optimization (Creates OrderAssignment with routes)
   ↓
Stage 3: Route Improvement (2-Opt optimization on sequences)
   ↓
Stage 4: Time Window Generation (Creates TimeWindow with confidence levels)
   ↓
Stage 5: Historical Tracking (RouteSegmentObservation records performance)
```

---

## Entity Relationships

### Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                          DRIVER                             │
│  (id, name, phone, vehicleType, maxOrders, status)          │
└──────────────┬──────────────────────────────┬───────────────┘
               │                              │
          1:M  │                              │ 1:M
               │                              │
        ┌──────▼─────────┐          ┌─────────▼────────┐
        │ DriverLocation  │          │ OrderAssignment   │
        │ (GPS tracking)  │          │ (delivery route)  │
        └─────────────────┘          └─────────┬────────┘
                                               │
                                          1:1  │
                                               │
                                       ┌───────▼──────┐
                                       │    ORDER     │
                                       │ (from client) │
                                       └──────────────┘

┌──────────────────────────┐
│ TimeWindow               │  ← Unique per orderId
│ (optimized [ℓ, u])       │     No FK to OrderAssignment
│ (generated per route)    │     Queried separately
└──────────────────────────┘

┌──────────────────────────────────┐
│ RouteSegmentObservation          │  ← Historical learning
│ (travel time recordings)         │     Independent entity
└──────────────────────────────────┘
```

### Summary Table

| From Entity | To Entity | Type | Cardinality | Join Key |
|---|---|---|---|---|
| Driver | DriverLocation | OneToMany | 1:M | driverId |
| Driver | OrderAssignment | OneToMany | 1:M | driverId |
| Order | OrderAssignment | OneToOne | 1:1 | orderId |
| OrderAssignment | Driver | ManyToOne | M:1 | driverId |
| OrderAssignment | Order | OneToOne | 1:1 | orderId |

---

## Entities

### 1. Order

**Purpose**: Represents a customer delivery request with minimal input data.

**Table**: `orders`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| pickupLat | FLOAT | NO | - | Pickup location latitude |
| pickupLng | FLOAT | NO | - | Pickup location longitude |
| pickupAddress | VARCHAR(255) | NO | - | Pickup street address |
| dropoffLat | FLOAT | NO | - | Dropoff location latitude |
| dropoffLng | FLOAT | NO | - | Dropoff location longitude |
| dropoffAddress | VARCHAR(255) | NO | - | Dropoff street address |
| requestedDeliveryDate | DATE | NO | - | Customer's requested delivery date (system generates time window) |
| preferredTimeSlot | VARCHAR(50) | YES | NULL | Optional: 'morning', 'afternoon', 'evening' |
| status | ENUM | NO | 'pending' | pending, assigned, picked_up, delivered, cancelled |
| priority | INT | NO | 5 | Priority 1-10, higher = more urgent |
| value | FLOAT | NO | 0 | Order value in dollars |
| createdAt | TIMESTAMP | NO | now() | Record creation time |
| updatedAt | TIMESTAMP | NO | now() | Last update time |

**Indexes**:
- `idx_orders_status` (status)
- `idx_orders_requestedDeliveryDate` (requestedDeliveryDate)

**Relationships**:
- 1:1 → OrderAssignment

**Key Design Decisions**:
- NO `deadline` or `readyTime` columns - time constraints are OUTPUT (TimeWindow), not INPUT
- `requestedDeliveryDate` is DATE (not TIMESTAMP) - actual time is generated during optimization
- `preferredTimeSlot` is optional - customer can be flexible
- Status enum uses business-meaningful states (not technical states)

---

### 2. OrderAssignment

**Purpose**: Represents a driver's assignment of an order with sequence information and estimated times.

**Table**: `order_assignments`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| orderId | UUID | NO | - | Foreign key to Order (1:1 relationship) - UNIQUE |
| driverId | UUID | NO | - | Foreign key to Driver (M:1 relationship) |
| sequence | INT | NO | - | Position in driver's route sequence (1-based) |
| estimatedPickup | TIMESTAMP | NO | - | Estimated pickup time (before time window optimization) |
| estimatedDelivery | TIMESTAMP | NO | - | Estimated delivery time (before time window optimization) |
| actualPickup | TIMESTAMP | YES | NULL | Actual pickup time (filled after execution) |
| actualDelivery | TIMESTAMP | YES | NULL | Actual delivery time (filled after execution) |
| assignedAt | TIMESTAMP | NO | now() | Time when assignment was created |
| updatedAt | TIMESTAMP | NO | now() | Last update time |

**Indexes**:
- `idx_order_assignments_orderId` (orderId)
- `idx_order_assignments_driverId` (driverId)

**Foreign Keys**:
- `orderId` → `orders.id` (CASCADE DELETE)
- `driverId` → `drivers.id` (CASCADE DELETE)

**Relationships**:
- 1:1 ← Order
- M:1 ← Driver
- NO direct relationship to TimeWindow (queried separately)

**Key Design Decisions**:
- `orderId` is UNIQUE - ensures each order has at most one assignment
- `estimatedPickup/Delivery` store pre-optimization estimates (simple heuristic)
- Actual times are filled during/after execution for performance tracking
- NO TimeWindow reference - TimeWindow is queried separately via orderId
- Sequence enables ordered route traversal

---

### 3. TimeWindow

**Purpose**: Stores the optimized delivery time window [ℓ, u] for a delivery stop, generated using statistical algorithms from the research paper.

**Table**: `time_windows`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| orderId | UUID | NO | - | Order this window belongs to - UNIQUE |
| driverId | UUID | NO | - | Driver assigned to this delivery |
| lowerBound | TIMESTAMP | NO | - | Lower bound ℓ (earliest service time) |
| upperBound | TIMESTAMP | NO | - | Upper bound u (latest service time) |
| windowWidthSeconds | INT | NO | - | Window width u - ℓ in seconds |
| expectedArrival | TIMESTAMP | NO | - | Expected arrival time E[T^k] (mean of distribution) |
| confidenceLevel | FLOAT | NO | - | Service level guarantee P(arrival ∈ [ℓ,u]) ∈ [0,1], e.g., 0.95 = 95% on-time |
| violationProbability | FLOAT | NO | - | Violation probability = 1 - confidenceLevel |
| penaltyWidth | FLOAT | NO | - | Penalty a_w: cost per second of window width |
| penaltyEarly | FLOAT | NO | - | Penalty a_ℓ: cost of early arrival |
| penaltyLate | FLOAT | NO | - | Penalty a_u: cost of late arrival (typically highest) |
| calculationMethod | VARCHAR(50) | NO | - | Method used: 'simple_heuristic', 'stochastic_saa', 'distributionally_robust' |
| sampleCount | INT | YES | NULL | Number of historical observations used (SAA method) |
| travelTimeStdDev | FLOAT | YES | NULL | Travel time standard deviation in seconds (SAA) |
| coefficientOfVariation | FLOAT | YES | NULL | σ/μ: coefficient of variation (SAA) |
| actualArrival | TIMESTAMP | YES | NULL | Actual arrival time (filled post-execution for validation) |
| wasWithinWindow | BOOLEAN | YES | NULL | Whether actual ∈ [ℓ, u] (performance metric) |
| deviationSeconds | INT | YES | NULL | Deviation: negative=early, positive=late |
| createdAt | TIMESTAMP | NO | now() | Record creation time |
| updatedAt | TIMESTAMP | NO | now() | Last update time |

**Indexes**:
- `idx_time_windows_orderId` (orderId)
- `idx_time_windows_driverId` (driverId)
- `idx_time_windows_bounds` (lowerBound, upperBound)
- `idx_time_windows_calculationMethod` (calculationMethod)

**Unique Constraints**:
- `orderId` is UNIQUE - one window per order

**Key Design Decisions**:
- NO foreign keys - TimeWindow references orderId without FK constraint
- Completely independent entity - queries it separately when needed
- Stores full optimization context (penalties, method, sample size)
- Performance tracking fields allow validation of algorithm accuracy
- Three calculation methods supported: heuristic → SAA → robust optimization

**Algorithm Reference**:
From paper "Service Time Window Design in Last-Mile Delivery" (Hosseini et al. 2025)

Minimizes: H^k = a_w·(u - ℓ) + a_ℓ·E[earliness] + a_u·E[lateness]

Where:
- [ℓ, u] are designed decision variables (bounds)
- a_w, a_ℓ, a_u are penalty weights
- E[·] is expectation over travel time distribution
- Three methods for computing bounds from travel time data

---

### 4. RouteSegmentObservation

**Purpose**: Records historical travel time observations for statistical modeling and continuous learning.

**Table**: `route_segment_observations`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| fromLat | FLOAT | NO | - | Route segment start latitude |
| fromLng | FLOAT | NO | - | Route segment start longitude |
| toLat | FLOAT | NO | - | Route segment end latitude |
| toLng | FLOAT | NO | - | Route segment end longitude |
| estimatedSeconds | INT | NO | - | Estimated travel time in seconds (from routing algorithm) |
| actualSeconds | INT | NO | - | Actual observed travel time in seconds |
| deviationSeconds | INT | NO | - | Deviation: actual - estimated (can be negative) |
| distanceMeters | FLOAT | NO | - | Haversine distance in meters |
| driverId | UUID | YES | NULL | Driver who executed this segment (optional for general patterns) |
| timeOfDay | VARCHAR(20) | YES | NULL | Time bucket: 'morning' (6-12), 'afternoon' (12-18), 'evening' (18-22), 'night' (22-6) |
| dayOfWeek | VARCHAR(20) | YES | NULL | Day: 'monday', 'tuesday', ..., 'sunday' |
| weatherCondition | VARCHAR(50) | YES | NULL | Weather condition during travel (if available): 'clear', 'rainy', 'snowy', etc. |
| timestamp | TIMESTAMP | NO | now() | When observation was recorded |

**Indexes**:
- `idx_route_segments_coords` (fromLat, fromLng, toLat, toLng) - spatial lookup
- `idx_route_segments_driverId` (driverId) - driver patterns
- `idx_route_segments_temporal` (timestamp) - time-based queries
- `idx_route_segments_context` (timeOfDay, dayOfWeek) - contextual patterns

**Key Design Decisions**:
- Completely independent - no foreign keys
- Spatial index on coordinates enables radius queries ("find observations near this segment")
- Temporal/contextual fields enable stratified analysis (morning vs evening, weekday vs weekend)
- Optional driverId allows tracking driver-specific patterns vs. general patterns
- Designed for SAA input: hundreds of observations per segment → empirical distribution

**Usage in TimeWindow Generation**:

```sql
-- Find observations for a route segment
SELECT actualSeconds FROM route_segment_observations
WHERE
  distance(fromLat, fromLng, toLat, toLng) < radiusKm
  AND timestamp > now() - INTERVAL '30 days'
  AND (timeOfDay IS NULL OR timeOfDay = 'morning')
ORDER BY actualSeconds;

-- Compute quantiles for bounds
SELECT
  percentile_cont(0.025) WITHIN GROUP (ORDER BY actualSeconds) as lowerQuantile,
  percentile_cont(0.975) WITHIN GROUP (ORDER BY actualSeconds) as upperQuantile
FROM ...
```

---

### 5. Driver

**Purpose**: Represents a delivery driver with vehicle and capacity information.

**Table**: `drivers`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| name | VARCHAR(255) | NO | - | Driver name |
| phone | VARCHAR(20) | NO | - | Phone number (UNIQUE) |
| vehicleType | VARCHAR(50) | NO | - | 'bike', 'scooter', 'car' |
| maxOrders | INT | NO | 3 | Maximum orders this driver can handle |
| status | ENUM | NO | 'offline' | offline, available, en_route_pickup, at_pickup, en_route_delivery, at_delivery |
| createdAt | TIMESTAMP | NO | now() | Record creation time |
| updatedAt | TIMESTAMP | NO | now() | Last update time |

**Indexes**:
- PRIMARY KEY (id)
- UNIQUE (phone)

**Relationships**:
- 1:M → DriverLocation
- 1:M → OrderAssignment

**Enum: DriverStatus**:
- `offline` - Not available for work
- `available` - Ready to accept orders
- `en_route_pickup` - Traveling to pickup location
- `at_pickup` - At pickup location
- `en_route_delivery` - Traveling to delivery location
- `at_delivery` - At delivery location

**Key Design Decisions**:
- Removed `rating` column - not used in current optimization
- Simple vehicle types map to capacity constraints
- Status tracks real-time driver state for operational visibility
- Phone is UNIQUE to prevent duplicate drivers

---

### 6. DriverLocation

**Purpose**: Tracks historical GPS locations of drivers for route visualization and performance analysis.

**Table**: `driver_locations`

**Columns**:

| Column | Type | Nullable | Default | Comment |
|---|---|---|---|---|
| id | UUID | NO | uuid_generate_v4() | Primary key |
| driverId | UUID | NO | - | Foreign key to Driver |
| lat | FLOAT | NO | - | GPS latitude coordinate |
| lng | FLOAT | NO | - | GPS longitude coordinate |
| heading | FLOAT | YES | NULL | Direction heading in degrees (0-360) |
| speed | FLOAT | YES | NULL | Current speed in km/h |
| timestamp | TIMESTAMP | NO | now() | When location was recorded |

**Indexes**:
- `idx_driver_locations_driverId` (driverId)
- `idx_driver_locations_temporal` (driverId, timestamp) - efficient time-range queries

**Foreign Keys**:
- `driverId` → `drivers.id` (CASCADE DELETE)

**Key Design Decisions**:
- Completely denormalized - stores raw GPS points
- Temporal index enables efficient "locations from driver X in time window Y" queries
- Optional heading and speed enable advanced route quality analysis
- CASCADE DELETE ensures cleanup when driver is deleted

---

## Data Flow

### Order Entry → Optimization → Execution

```
1. ORDER ENTRY (Customer)
   ├─ Create Order with:
   │  ├─ Pickup location (lat, lng, address)
   │  ├─ Dropoff location (lat, lng, address)
   │  ├─ requestedDeliveryDate (DATE)
   │  └─ preferredTimeSlot (optional)
   └─ Order.status = PENDING

2. ROUTE OPTIMIZATION (System - Stages 1-3)
   ├─ Stage 1: Territory Sectorization
   │  └─ Assign orders to geographic sectors
   ├─ Stage 2: Nearest Neighbor + Stage 3: 2-Opt
   │  └─ Create OrderAssignment records:
   │     ├─ driverId (assigned driver)
   │     ├─ sequence (position in route)
   │     ├─ estimatedPickup (pre-optimization)
   │     └─ estimatedDelivery (pre-optimization)
   └─ Order.status = ASSIGNED

3. TIME WINDOW GENERATION (System - Stage 4)
   ├─ For each OrderAssignment:
   │  ├─ Calculate expectedArrival (based on route + distance)
   │  ├─ Query RouteSegmentObservation for historical data
   │  ├─ Compute [ℓ, u] using selected method:
   │  │  ├─ simple_heuristic (no historical data needed)
   │  │  ├─ stochastic_saa (requires ≥30 samples)
   │  │  └─ distributionally_robust (requires mean + covariance)
   │  └─ Create TimeWindow with:
   │     ├─ lowerBound, upperBound
   │     ├─ confidenceLevel
   │     └─ calculationMethod
   └─ Time windows are now ready to communicate to customer

4. EXECUTION (Driver)
   ├─ Pick up order
   │  └─ OrderAssignment.actualPickup = now()
   ├─ Drive to delivery location
   │  └─ Record DriverLocation samples continuously
   └─ Deliver order
      ├─ OrderAssignment.actualDelivery = now()
      ├─ Order.status = DELIVERED
      └─ TimeWindow.actualArrival = now()

5. LEARNING (System)
   ├─ For each completed delivery:
   │  └─ Create RouteSegmentObservation:
   │     ├─ fromLat/Lng, toLat/Lng
   │     ├─ estimatedSeconds (from optimization)
   │     ├─ actualSeconds (actual travel time)
   │     ├─ deviationSeconds
   │     └─ timeOfDay, dayOfWeek, driverId
   ├─ Update TimeWindow performance metrics:
   │  ├─ wasWithinWindow = (actualArrival ∈ [ℓ, u])
   │  └─ deviationSeconds
   └─ Build empirical distribution for next optimization

ALGORITHM EVOLUTION:
├─ Phase 1: simple_heuristic (no historical data)
├─ Phase 2: stochastic_saa (with ≥30 observations per segment)
└─ Phase 3: distributionally_robust (advanced uncertainty modeling)
```

---

## Constraints & Indexes

### Primary Keys
- All entities use UUID v4 as primary key
- Generation: `DEFAULT uuid_generate_v4()`

### Unique Constraints
- `drivers.phone` - Ensure no duplicate phone numbers
- `time_windows.orderId` - Exactly one window per order

### Foreign Keys

| Table | Column | References | Action |
|---|---|---|---|
| order_assignments | orderId | orders.id | CASCADE |
| order_assignments | driverId | drivers.id | CASCADE |
| driver_locations | driverId | drivers.id | CASCADE |

### Indexes Summary

| Table | Indexes | Purpose |
|---|---|---|
| orders | (status), (requestedDeliveryDate) | Query pending orders, filter by date |
| order_assignments | (orderId), (driverId) | Quick lookups by order or driver |
| time_windows | (orderId), (driverId), (lowerBound, upperBound), (calculationMethod) | Look up window by order; range queries on times; filter by method |
| route_segment_observations | (fromLat, fromLng, toLat, toLng), (driverId), (timestamp), (timeOfDay, dayOfWeek) | Spatial queries; driver pattern analysis; temporal/contextual filtering |
| driver_locations | (driverId), (driverId, timestamp) | Latest location per driver; time-range queries |

---

## Design Decisions

### Why NO `deadline` or `readyTime` in Order?

**Decision**: Remove hard time constraints from Order entity.

**Rationale**:
- TimeWindow is OUTPUT (computed), not INPUT (constraint)
- Paper's algorithm GENERATES windows, doesn't fit to them
- Paradigm shift: "What time window can we reliably meet?" vs "Can we meet customer's deadline?"
- Enables more realistic service level agreements (e.g., "95% on-time")

---

### Why NO direct FK from OrderAssignment to TimeWindow?

**Decision**: Store only orderId reference in TimeWindow, no FK constraint.

**Rationale**:
- TimeWindow.orderId is UNIQUE - logically 1:1 but stored independently
- Avoids duplicate constraint definitions
- Separates concerns: OrderAssignment = routing, TimeWindow = optimization
- Allows independent evolution of both entities
- Queries join on orderId when needed

---

### Why RouteSegmentObservation is Independent?

**Decision**: No foreign keys from RouteSegmentObservation.

**Rationale**:
- Designed for LEARNING, not operational tracking
- High volume (hundreds per day) with independent lifecycle
- Spatial index on coordinates for efficient "nearby segments" queries
- Optional driverId allows both general AND driver-specific patterns
- Temporal/contextual fields (timeOfDay, dayOfWeek) enable stratified learning

---

### Why DriverLocation is Denormalized?

**Decision**: Store raw GPS points with timestamps instead of computed positions.

**Rationale**:
- Raw data enables various post-processing (smoothing, anomaly detection)
- Temporal index supports efficient time-range queries
- Optional heading/speed support future analytics
- Separate entity keeps it independent from routing

---

### Entity Temporal Fields

All entities have:
- `createdAt` - When record was created (SET DEFAULT now())
- `updatedAt` - When record was last modified (SET DEFAULT now() ON UPDATE now())

Exceptions:
- `RouteSegmentObservation` uses `timestamp` instead (when observation occurred)
- `DriverLocation` uses `timestamp` (when location was recorded)

---

### Enum Use

**OrderStatus** values:
- `pending` - Not yet assigned
- `assigned` - Assigned to driver, awaiting execution
- `picked_up` - Driver picked up the order
- `delivered` - Order delivered
- `cancelled` - Cancelled before delivery

**DriverStatus** values:
- `offline` - Not working
- `available` - Ready to accept orders
- `en_route_pickup` - Going to pickup location
- `at_pickup` - At pickup location
- `en_route_delivery` - Going to delivery location
- `at_delivery` - At delivery location

---

### NULL Handling

**Nullable columns** (and when populated):

| Column | Entity | Populated When |
|---|---|---|
| preferredTimeSlot | Order | Customer specifies preference |
| actualPickup | OrderAssignment | Driver picks up order |
| actualDelivery | OrderAssignment | Driver delivers order |
| actualArrival | TimeWindow | Driver arrives at delivery |
| wasWithinWindow | TimeWindow | Delivery completed |
| deviationSeconds | TimeWindow | Delivery completed |
| sampleCount | TimeWindow | Using SAA method |
| travelTimeStdDev | TimeWindow | Using SAA method |
| coefficientOfVariation | TimeWindow | Using SAA method |
| driverId | RouteSegmentObservation | If tracking driver-specific patterns |
| timeOfDay | RouteSegmentObservation | If time bucket is available |
| dayOfWeek | RouteSegmentObservation | If day info is available |
| weatherCondition | RouteSegmentObservation | If weather data is available |
| heading | DriverLocation | If heading is available |
| speed | DriverLocation | If speed is available |

---

## Migration & Versioning

**Current Version**: Defined in migration `InitSchema1764078406734`

**Entity Registration**: All entities must be registered in `src/config/ormconfig.ts`:

```typescript
entities: [
  Driver,
  DriverLocation,
  Order,
  OrderAssignment,
  TimeWindow,
  RouteSegmentObservation,
]
```

**Migration Strategy**:
- Create new migration for schema changes: `npm run typeorm:generate`
- Review generated migration for correctness
- Run migration: `npm run db:migrate`
- Never modify existing migrations

---

## Performance Considerations

### Indexing Strategy

**High-cardinality indexes** (many distinct values):
- `orders.status` - Good selectivity
- `order_assignments.driverId` - Good selectivity
- `time_windows.orderId` - Very high selectivity

**Composite indexes** (multiple columns):
- `order_assignments(driverId, orderId)` - Join queries
- `driver_locations(driverId, timestamp)` - Time-range queries
- `route_segment_observations(fromLat, fromLng, toLat, toLng)` - Spatial radius queries

### Query Patterns

**Frequent Queries**:

```sql
-- Get pending orders
SELECT * FROM orders WHERE status = 'pending' ORDER BY priority DESC;

-- Get driver's current route
SELECT o.*, oa.sequence FROM orders o
JOIN order_assignments oa ON o.id = oa.orderId
WHERE oa.driverId = ? AND o.status != 'delivered'
ORDER BY oa.sequence;

-- Get time window for order
SELECT * FROM time_windows WHERE orderId = ?;

-- Find similar route segments (spatial)
SELECT * FROM route_segment_observations
WHERE
  ST_DWithin(ST_MakePoint(fromLng, fromLat), ST_MakePoint(?, ?), 1000)
  AND timestamp > now() - INTERVAL '30 days'
LIMIT 100;
```

### Scaling Considerations

**Current Design Supports**:
- ✅ 50+ concurrent drivers
- ✅ 250+ orders per day
- ✅ 1000+ RouteSegmentObservations per day
- ✅ Multi-country/region distribution

**Optimization Path**:
1. Add pagination for large result sets
2. Implement query result caching
3. Archive old RouteSegmentObservations (>90 days)
4. Consider TimescaleDB for time-series data (RouteSegmentObservation)
5. Implement database sharding by region/geography

---

## Summary

The EdgeRun schema is optimized for:
1. **Separation of concerns** - Each entity has clear purpose and lifecycle
2. **Research-backed optimization** - Time windows are designed outputs, not constraints
3. **Continuous learning** - RouteSegmentObservation enables data-driven improvements
4. **Scalability** - Denormalized independent entities support high throughput
5. **Operational visibility** - Status enums and timestamps enable real-time tracking

The design supports the complete delivery optimization pipeline: order entry → route optimization → time window generation → execution → learning.
