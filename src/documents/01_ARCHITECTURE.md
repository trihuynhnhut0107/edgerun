# System Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     EdgeRun Backend API                     │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  Order Service   │─────▶│ Matching Engine  │─────▶│ Route Optimizer  │
│  (Ingestion)     │      │  (Assignment)    │      │  (Navigation)    │
└──────────────────┘      └──────────────────┘      └──────────────────┘
         │                         │                          │
         │                         ▼                          ▼
         │                ┌─────────────────┐       ┌─────────────────┐
         │                │  Driver State   │       │   Geospatial    │
         │                │    Manager      │       │     Engine      │
         │                └─────────────────┘       └─────────────────┘
         │                         │                          │
         ▼                         ▼                          ▼
┌─────────────────────────────────────────────────────────────┐
│          PostgreSQL + PostGIS + Redis + OSRM                │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

### 1. Order Service
**Purpose**: Receive and validate incoming orders

**Responsibilities**:
- Accept order creation requests
- Validate location coordinates
- Store order in database
- Trigger matching engine

**API Endpoints**:
```
POST /api/orders          # Create new order
GET  /api/orders/{id}     # Get order details
GET  /api/orders          # List orders (filtered)
```

### 2. Matching Engine
**Purpose**: Assign orders to optimal drivers

**Responsibilities**:
- Query available drivers within radius
- Score each driver candidate
- Select best match based on constraints
- Create order assignment

**Core Algorithm**:
```typescript
async function matchOrderToDriver(order: Order): Promise<Driver | null> {
    // 1. Find available drivers within 5km
    const candidates = await findNearbyDrivers(order.pickupLocation, 5000);

    // 2. Score each candidate
    const scoredDrivers = candidates.map(driver => ({
        driver,
        score: calculateMatchScore(order, driver)
    }));

    // 3. Sort by score and select best
    const best = scoredDrivers.sort((a, b) => b.score - a.score)[0];
    if (!best) return null;

    // 4. Assign order
    await assignOrder(order.id, best.driver.id);
    return best.driver;
}
```

### 3. Route Optimizer
**Purpose**: Calculate optimal multi-stop routes for drivers

**Responsibilities**:
- Fetch driver's active orders
- Calculate optimal stop sequence
- Generate turn-by-turn navigation
- Update ETAs

**Integration**:
- Uses OSRM for distance/duration calculations
- Implements simple TSP solver for 2-5 stops

### 4. Driver State Manager
**Purpose**: Track real-time driver availability and location

**Responsibilities**:
- Update driver GPS locations
- Manage driver status transitions
- Track active orders per driver
- Handle driver online/offline events

**State Model**:
```typescript
enum DriverStatus {
    OFFLINE = "offline",
    AVAILABLE = "available",                  // Online, no orders
    EN_ROUTE_PICKUP = "en_route_pickup",
    AT_PICKUP = "at_pickup",
    EN_ROUTE_DELIVERY = "en_route_delivery",
    AT_DELIVERY = "at_delivery"
}
```

### 5. Geospatial Engine
**Purpose**: Fast proximity queries and distance calculations

**Responsibilities**:
- Store driver locations in PostGIS
- Perform radius searches
- Calculate distances between points
- Query routing service (OSRM)

**Technology**:
- **PostGIS** for persistent spatial data
- **Redis Geospatial** for real-time driver locations (optional optimization)
- **OSRM** for accurate driving distances

## Data Flow

### Scenario: New Order Assignment

```
1. POST /api/orders
   ↓
2. orderService.createOrder()
   → Store in PostgreSQL
   ↓
3. matchingEngine.matchOrder()
   → Query geospatialEngine.findNearbyDrivers()
   → Calculate scores for each candidate
   → Select best driver
   ↓
4. driverStateManager.assignOrder()
   → Update driver status
   → Store assignment
   ↓
5. routeOptimizer.recalculateRoute()
   → Fetch driver's orders
   → Call OSRM for distances
   → Solve TSP for stop sequence
   → Return optimized route
   ↓
6. Return assignment to client
   {driverId, estimatedPickup, estimatedDelivery}
```

## Database Schema (High-Level)

```sql
-- Core entities
orders (id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, status, ...)
drivers (id, name, vehicle_type, max_orders, rating, ...)
driver_locations (driver_id, location GEOGRAPHY, timestamp, ...)
order_assignments (order_id, driver_id, sequence, estimated_pickup, ...)

-- Indexes
CREATE INDEX idx_driver_locations_geom ON driver_locations USING GIST(location);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_assignments_driver ON order_assignments(driver_id);
```

## Technology Justification

### Why PostgreSQL + PostGIS?
- Free, open-source, battle-tested
- PostGIS provides efficient geospatial queries (ST_DWithin, ST_Distance)
- Single database for all data (simplicity)
- ACID guarantees for order/assignment consistency

### Why OSRM?
- Free, self-hosted routing engine
- Accurate driving distances (vs haversine approximations)
- Fast (<100ms for typical queries)
- Docker-ready, easy local setup

### Why Express.js + TypeScript?
- Battle-tested Node.js framework
- Large ecosystem and community
- TypeScript for type safety and better developer experience
- Async/await support for handling concurrent requests

### Why Redis? (Optional)
- Future optimization for real-time driver locations
- Not required for MVP, can add later
- Useful for caching frequently accessed data

## Deployment (Local Development)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgis/postgis:15-3.3
    ports: ["5432:5432"]

  osrm:
    image: osrm/osrm-backend
    volumes:
      - ./osrm-data:/data
    # See Region Selection doc for data download

  api:
    build: .
    ports: ["8000:8000"]
    depends_on: [postgres, osrm]
```

## Performance Targets (MVP)

- **Order Assignment**: <500ms (P95)
- **Route Calculation**: <2s for 5 stops (P95)
- **Geospatial Query**: <100ms for 5km radius search (P95)
- **Throughput**: 100 orders/min (single instance)

## Scalability Path (Future)

When needed, scale horizontally:
1. Read replicas for PostgreSQL
2. Redis for driver location caching
3. Message queue (RabbitMQ/Kafka) for async matching
4. Load balancer for multiple API instances

**But for MVP**: Single server, focus on algorithm quality.
