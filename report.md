# Draft Phase Implementation Plan - EdgeRun Matching Engine

## Executive Summary

This plan outlines the implementation of a database-persisted draft assignment system for the EdgeRun matching engine, replacing the current in-memory `DraftMemory` approach. The new system will use **Clarke-Wright Savings Algorithm + ALNS (Adaptive Large Neighborhood Search)** to optimize driver-order assignments with 90-99% optimal solution quality in under 2.5 seconds.

**Key Changes:**
- Replace in-memory `DraftMemory` with database-persisted `DraftAssignments` entity
- Implement Clarke-Wright Savings algorithm for route construction (85-95% optimal, <150ms)
- Add ALNS metaheuristic for route improvement (95-99% optimal, 1-2s)
- Implement distance matrix caching to reduce Mapbox API costs by 80-90%
- Use Mapbox Matrix API for batch distance calculations
- Store multiple draft groups for comparison and selection

---

## 1. Database Schema Design

### 1.1 DraftAssignments Entity

```typescript
@Entity('draft_assignments')
export class DraftAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'draft_group_id' })
  draftGroupId: number; // Identifies complete assignment solution (1, 2, 3, ...)

  @Column({ name: 'driver_id' })
  driverId: string;

  @Column({ name: 'order_id' })
  orderId: string;

  @Column()
  sequence: number; // Position in driver's route (1, 2, 3, ...)

  @Column({ type: 'timestamp' })
  estimatedPickupTime: Date;

  @Column({ type: 'timestamp' })
  estimatedDeliveryTime: Date;

  @Column({ type: 'float' })
  travelTimeToPickup: number; // Minutes from previous stop to pickup

  @Column({ type: 'float' })
  travelTimeToDelivery: number; // Minutes from pickup to delivery

  @Column({ type: 'jsonb', nullable: true })
  metadata: {
    insertionCost: number; // Cost added to route by this assignment
    distanceToPickup: number; // Meters
    distanceToDelivery: number; // Meters
    previousStopLocation?: { lat: number; lng: number };
  };

  @CreateDateColumn()
  createdAt: Date;

  // Relations
  @ManyToOne(() => Driver)
  @JoinColumn({ name: 'driver_id' })
  driver: Driver;

  @ManyToOne(() => Order)
  @JoinColumn({ name: 'order_id' })
  order: Order;

  @ManyToOne(() => DraftGroup)
  @JoinColumn({ name: 'draft_group_id' })
  draftGroup: DraftGroup;
}
```

### 1.2 DraftGroup Entity

```typescript
@Entity('draft_groups')
export class DraftGroup {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'uuid' })
  sessionId: string; // Links groups from same optimization run

  @Column({ type: 'float' })
  totalTravelTime: number; // Sum of all travel times (minutes)

  @Column({ type: 'float' })
  totalDistance: number; // Sum of all distances (meters)

  @Column({ type: 'float' })
  averagePickupTime: number; // Average time to pickup across all orders

  @Column({ type: 'int' })
  ordersCount: number;

  @Column({ type: 'int' })
  driversCount: number;

  @Column({ type: 'jsonb' })
  metadata: {
    algorithm: 'clarke-wright' | 'insertion' | 'alns';
    computationTimeMs: number;
    qualityScore: number; // 0-1 score vs theoretical optimal
    constraintsViolated: string[];
  };

  @Column({ type: 'boolean', default: false })
  isSelected: boolean; // Winning draft group

  @CreateDateColumn()
  createdAt: Date;

  // Relations
  @OneToMany(() => DraftAssignment, assignment => assignment.draftGroup)
  assignments: DraftAssignment[];
}
```

### 1.3 DistanceCache Entity

```typescript
@Entity('distance_cache')
export class DistanceCache {
  @PrimaryColumn()
  id: string; // Hash of origin + destination + profile

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  origin: { type: 'Point'; coordinates: [number, number] };

  @Column({ type: 'geography', spatialFeatureType: 'Point', srid: 4326 })
  destination: { type: 'Point'; coordinates: [number, number] };

  @Column()
  profile: string; // 'driving', 'driving-traffic', 'cycling', etc.

  @Column({ type: 'float' })
  distance: number; // Meters

  @Column({ type: 'float' })
  duration: number; // Seconds

  @Column({ type: 'jsonb', nullable: true })
  routeGeometry?: any; // Optional GeoJSON route

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp' })
  expiresAt: Date; // TTL for cache invalidation (7 days default)

  @Index()
  @Column({ type: 'tsvector', nullable: true })
  searchVector?: any; // For fast location-based lookups
}
```

### 1.4 Database Indexes

```sql
-- DraftAssignments indexes
CREATE INDEX idx_draft_assignments_group ON draft_assignments(draft_group_id);
CREATE INDEX idx_draft_assignments_driver ON draft_assignments(driver_id);
CREATE INDEX idx_draft_assignments_order ON draft_assignments(order_id);
CREATE INDEX idx_draft_assignments_sequence ON draft_assignments(draft_group_id, driver_id, sequence);

-- DraftGroup indexes
CREATE INDEX idx_draft_groups_session ON draft_groups(session_id);
CREATE INDEX idx_draft_groups_selected ON draft_groups(is_selected) WHERE is_selected = true;
CREATE INDEX idx_draft_groups_total_time ON draft_groups(total_travel_time);

-- DistanceCache indexes (spatial)
CREATE INDEX idx_distance_cache_origin ON distance_cache USING GIST(origin);
CREATE INDEX idx_distance_cache_destination ON distance_cache USING GIST(destination);
CREATE INDEX idx_distance_cache_expires ON distance_cache(expires_at);
CREATE INDEX idx_distance_cache_composite ON distance_cache(id, expires_at) WHERE expires_at > NOW();
```

---

## 2. Algorithm Implementation

### 2.1 Clarke-Wright Savings Algorithm (Construction Phase)

**Purpose**: Generate initial feasible solution quickly (85-95% optimal)

**Algorithm Flow**:
```typescript
interface Saving {
  orderId1: string;
  orderId2: string;
  value: number; // s(i,j) = d(depot,i) + d(depot,j) - d(i,j)
}

class ClarkeWrightSolver {
  async solve(orders: Order[], drivers: Driver[]): Promise<DraftGroup> {
    // Step 1: Calculate savings for all order pairs
    const savings = await this.calculateSavings(orders);

    // Step 2: Sort savings in descending order
    savings.sort((a, b) => b.value - a.value);

    // Step 3: Initialize routes (one order per driver)
    const routes = this.initializeRoutes(orders, drivers);

    // Step 4: Merge routes based on savings
    for (const saving of savings) {
      const route1 = routes.find(r => r.endsWith(saving.orderId1));
      const route2 = routes.find(r => r.startsWith(saving.orderId2));

      if (route1 && route2 && this.canMerge(route1, route2)) {
        routes = this.mergeRoutes(route1, route2);
      }
    }

    // Step 5: Persist as draft group
    return this.persistDraftGroup(routes, 'clarke-wright');
  }

  private async calculateSavings(orders: Order[]): Promise<Saving[]> {
    const savings: Saving[] = [];
    const depot = await this.getDepotLocation();

    // Use cached distances from distance matrix
    for (let i = 0; i < orders.length; i++) {
      for (let j = i + 1; j < orders.length; j++) {
        const distDepotI = await this.getDistance(depot, orders[i].pickupLocation);
        const distDepotJ = await this.getDistance(depot, orders[j].pickupLocation);
        const distIJ = await this.getDistance(orders[i].dropoffLocation, orders[j].pickupLocation);

        const savingValue = distDepotI + distDepotJ - distIJ;

        savings.push({
          orderId1: orders[i].id,
          orderId2: orders[j].id,
          value: savingValue
        });
      }
    }

    return savings;
  }

  private canMerge(route1: Route, route2: Route): boolean {
    // Check constraints:
    // 1. Driver capacity
    // 2. VRPPD constraint (pickup before delivery)
    // 3. Time windows
    // 4. Vehicle type compatibility

    const totalOrders = route1.orders.length + route2.orders.length;
    const driver = route1.driver;

    if (totalOrders > driver.maxOrders) return false;
    if (!this.validateVRPPD(route1, route2)) return false;
    if (!this.validateTimeWindows(route1, route2)) return false;

    return true;
  }
}
```

**Time Complexity**: O(n² log n)
- Savings calculation: O(n²)
- Sorting: O(n² log n)
- Merging: O(n²) worst case

**Expected Performance**: 50ms-150ms for 50 orders

### 2.2 ALNS (Adaptive Large Neighborhood Search) - Improvement Phase

**Purpose**: Improve Clarke-Wright solution to near-optimal (95-99%)

**Algorithm Flow**:
```typescript
interface ALNSOperator {
  name: string;
  weight: number; // Adaptive weight based on success
  execute: (solution: Solution) => Solution;
}

class ALNSSolver {
  private destroyOperators: ALNSOperator[] = [
    { name: 'random_removal', weight: 1.0, execute: this.randomRemoval },
    { name: 'worst_removal', weight: 1.5, execute: this.worstRemoval },
    { name: 'related_removal', weight: 1.2, execute: this.relatedRemoval }
  ];

  private repairOperators: ALNSOperator[] = [
    { name: 'greedy_insert', weight: 1.5, execute: this.greedyInsertion },
    { name: 'regret_insert', weight: 1.3, execute: this.regretInsertion }
  ];

  async improve(
    initialSolution: DraftGroup,
    timeLimitMs: number = 2000
  ): Promise<DraftGroup> {
    let currentSolution = initialSolution;
    let bestSolution = initialSolution;
    let temperature = this.calculateInitialTemperature(initialSolution);

    const startTime = Date.now();
    let iteration = 0;
    let noImprovementCount = 0;

    while (Date.now() - startTime < timeLimitMs && noImprovementCount < 50) {
      // Select operators adaptively based on weights
      const destroyOp = this.selectOperator(this.destroyOperators);
      const repairOp = this.selectOperator(this.repairOperators);

      // Destroy: Remove 15% of orders
      const destroyed = destroyOp.execute(currentSolution);

      // Repair: Reinsert removed orders
      const repaired = repairOp.execute(destroyed);

      // Acceptance criterion (simulated annealing)
      const delta = repaired.totalTravelTime - currentSolution.totalTravelTime;

      if (delta < 0 || Math.random() < Math.exp(-delta / temperature)) {
        currentSolution = repaired;

        if (currentSolution.totalTravelTime < bestSolution.totalTravelTime) {
          bestSolution = currentSolution;
          noImprovementCount = 0;

          // Increase weights of successful operators
          this.updateOperatorWeights(destroyOp, repairOp, 1.5);
        } else {
          noImprovementCount++;
        }
      } else {
        noImprovementCount++;
      }

      // Cool down temperature
      temperature *= 0.995;
      iteration++;
    }

    return this.persistDraftGroup(bestSolution, 'alns');
  }

  private randomRemoval(solution: Solution): Solution {
    const ordersToRemove = Math.ceil(solution.assignments.length * 0.15);
    const removed = new Set<string>();

    while (removed.size < ordersToRemove) {
      const randomIndex = Math.floor(Math.random() * solution.assignments.length);
      removed.add(solution.assignments[randomIndex].orderId);
    }

    return this.removeOrders(solution, Array.from(removed));
  }

  private worstRemoval(solution: Solution): Solution {
    // Remove orders with highest insertion cost
    const sortedByIC = [...solution.assignments].sort(
      (a, b) => b.metadata.insertionCost - a.metadata.insertionCost
    );

    const ordersToRemove = sortedByIC.slice(0, Math.ceil(sortedByIC.length * 0.15));
    return this.removeOrders(solution, ordersToRemove.map(a => a.orderId));
  }

  private greedyInsertion(solution: Solution): Solution {
    // Insert each removed order at position with minimum cost increase
    for (const order of solution.removedOrders) {
      let bestDriver: Driver = null;
      let bestPosition = 0;
      let minCost = Infinity;

      for (const driver of solution.drivers) {
        for (let pos = 0; pos <= driver.route.length; pos++) {
          const cost = this.calculateInsertionCost(driver, order, pos);

          if (cost < minCost && this.isFeasible(driver, order, pos)) {
            minCost = cost;
            bestDriver = driver;
            bestPosition = pos;
          }
        }
      }

      solution = this.insertOrder(solution, order, bestDriver, bestPosition);
    }

    return solution;
  }
}
```

**Time Complexity**: O(iterations × n) with early stopping
**Expected Performance**: 500ms-2000ms for 50 orders, 100-500 iterations

---

## 3. Distance Matrix Caching System

### 3.1 Cache Service Implementation

```typescript
@Injectable()
export class DistanceCacheService {
  private readonly CACHE_TTL_DAYS = 7;
  private readonly GRID_PRECISION = 0.001; // ~100m resolution

  constructor(
    @InjectRepository(DistanceCache)
    private cacheRepo: Repository<DistanceCache>,
    private mapboxClient: MapboxClient
  ) {}

  /**
   * Get distance between two locations with caching
   */
  async getDistance(
    origin: Location,
    destination: Location,
    profile: string = 'driving-traffic'
  ): Promise<{ distance: number; duration: number }> {
    // 1. Generate cache key
    const cacheKey = this.generateCacheKey(origin, destination, profile);

    // 2. Check cache
    const cached = await this.cacheRepo.findOne({
      where: { id: cacheKey, expiresAt: MoreThan(new Date()) }
    });

    if (cached) {
      return {
        distance: cached.distance,
        duration: cached.duration
      };
    }

    // 3. Fetch from Mapbox if not cached
    const result = await this.mapboxClient.getDistance(origin, destination, profile);

    // 4. Store in cache
    await this.cacheRepo.save({
      id: cacheKey,
      origin: { type: 'Point', coordinates: [origin.lng, origin.lat] },
      destination: { type: 'Point', coordinates: [destination.lng, destination.lat] },
      profile,
      distance: result.distance,
      duration: result.duration,
      expiresAt: new Date(Date.now() + this.CACHE_TTL_DAYS * 24 * 60 * 60 * 1000)
    });

    return result;
  }

  /**
   * Batch fetch distance matrix with caching
   */
  async getDistanceMatrix(
    locations: Location[],
    profile: string = 'driving-traffic'
  ): Promise<number[][]> {
    const n = locations.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));
    const uncachedPairs: Array<[number, number]> = [];

    // 1. Check cache for all pairs
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const cached = await this.getDistance(locations[i], locations[j], profile);

        if (cached) {
          matrix[i][j] = cached.distance;
          matrix[j][i] = cached.distance;
        } else {
          uncachedPairs.push([i, j]);
        }
      }
    }

    // 2. Batch fetch uncached pairs from Mapbox Matrix API
    if (uncachedPairs.length > 0) {
      const batchResults = await this.mapboxClient.getMatrix(
        uncachedPairs.map(([i, j]) => [locations[i], locations[j]]),
        profile
      );

      // 3. Update matrix and cache
      for (let idx = 0; idx < uncachedPairs.length; idx++) {
        const [i, j] = uncachedPairs[idx];
        const distance = batchResults[idx].distance;

        matrix[i][j] = distance;
        matrix[j][i] = distance;

        // Cache the result
        await this.getDistance(locations[i], locations[j], profile);
      }
    }

    return matrix;
  }

  /**
   * Generate stable cache key from locations
   */
  private generateCacheKey(
    origin: Location,
    destination: Location,
    profile: string
  ): string {
    // Grid-based hashing for nearby locations
    const originGrid = this.gridHash(origin.lat, origin.lng);
    const destGrid = this.gridHash(destination.lat, destination.lng);

    // Normalize order (A→B same as B→A for symmetric distances)
    const [p1, p2] = [originGrid, destGrid].sort();

    return `${p1}_${p2}_${profile}`;
  }

  private gridHash(lat: number, lng: number): string {
    const latGrid = Math.round(lat / this.GRID_PRECISION);
    const lngGrid = Math.round(lng / this.GRID_PRECISION);
    return `${latGrid}_${lngGrid}`;
  }

  /**
   * Pre-warm cache for common routes (run during off-peak hours)
   */
  async prewarmCache(locations: Location[], profile: string = 'driving-traffic') {
    await this.getDistanceMatrix(locations, profile);
  }

  /**
   * Clean expired cache entries
   */
  @Cron('0 3 * * *') // Run at 3 AM daily
  async cleanExpiredCache() {
    await this.cacheRepo.delete({
      expiresAt: LessThan(new Date())
    });
  }
}
```

### 3.2 Mapbox Matrix API Integration

```typescript
@Injectable()
export class MapboxClient {
  private readonly MATRIX_API_URL = 'https://api.mapbox.com/directions-matrix/v1';
  private readonly MAX_COORDINATES_PER_REQUEST = 25;

  /**
   * Fetch distance matrix from Mapbox (batch request)
   */
  async getMatrix(
    locationPairs: Array<[Location, Location]>,
    profile: string = 'driving-traffic'
  ): Promise<Array<{ distance: number; duration: number }>> {
    // Flatten unique locations
    const uniqueLocations = this.deduplicateLocations(locationPairs);

    // Split into batches of 25 coordinates max
    const batches = this.chunkArray(uniqueLocations, this.MAX_COORDINATES_PER_REQUEST);
    const results: Array<{ distance: number; duration: number }> = [];

    for (const batch of batches) {
      const coordinates = batch.map(loc => `${loc.lng},${loc.lat}`).join(';');
      const url = `${this.MATRIX_API_URL}/${profile}/${coordinates}`;

      const response = await axios.get(url, {
        params: {
          access_token: process.env.MAPBOX_ACCESS_TOKEN,
          annotations: 'distance,duration'
        }
      });

      // Parse matrix response
      const distances = response.data.distances;
      const durations = response.data.durations;

      // Map back to original pairs
      for (const [origin, destination] of locationPairs) {
        const originIdx = batch.findIndex(l => this.isSameLocation(l, origin));
        const destIdx = batch.findIndex(l => this.isSameLocation(l, destination));

        if (originIdx !== -1 && destIdx !== -1) {
          results.push({
            distance: distances[originIdx][destIdx],
            duration: durations[originIdx][destIdx]
          });
        }
      }
    }

    return results;
  }

  private deduplicateLocations(pairs: Array<[Location, Location]>): Location[] {
    const seen = new Set<string>();
    const unique: Location[] = [];

    for (const [origin, destination] of pairs) {
      for (const loc of [origin, destination]) {
        const key = `${loc.lat.toFixed(6)},${loc.lng.toFixed(6)}`;
        if (!seen.has(key)) {
          seen.add(key);
          unique.push(loc);
        }
      }
    }

    return unique;
  }
}
```

---

## 4. Draft Group Management

### 4.1 Draft Service Implementation

```typescript
@Injectable()
export class DraftService {
  constructor(
    @InjectRepository(DraftAssignment)
    private draftRepo: Repository<DraftAssignment>,
    @InjectRepository(DraftGroup)
    private groupRepo: Repository<DraftGroup>,
    private clarkeWrightSolver: ClarkeWrightSolver,
    private alnsSolver: ALNSSolver,
    private distanceCache: DistanceCacheService
  ) {}

  /**
   * Main entry point: Generate multiple draft groups and select best
   */
  async generateDraftGroups(
    orders: Order[],
    drivers: Driver[],
    numGroups: number = 3
  ): Promise<DraftGroup> {
    const sessionId = uuidv4();
    const groups: DraftGroup[] = [];

    // Generate multiple draft groups with different strategies
    for (let i = 0; i < numGroups; i++) {
      let group: DraftGroup;

      switch (i % 3) {
        case 0:
          // Pure Clarke-Wright
          group = await this.clarkeWrightSolver.solve(orders, drivers);
          break;

        case 1:
          // Clarke-Wright + ALNS
          const cwSolution = await this.clarkeWrightSolver.solve(orders, drivers);
          group = await this.alnsSolver.improve(cwSolution, 2000);
          break;

        case 2:
          // ALNS with longer time limit
          const cwSolution2 = await this.clarkeWrightSolver.solve(orders, drivers);
          group = await this.alnsSolver.improve(cwSolution2, 5000);
          break;
      }

      group.sessionId = sessionId;
      await this.groupRepo.save(group);
      groups.push(group);
    }

    // Select best group (minimum total travel time)
    const bestGroup = groups.reduce((best, current) =>
      current.totalTravelTime < best.totalTravelTime ? current : best
    );

    bestGroup.isSelected = true;
    await this.groupRepo.save(bestGroup);

    return bestGroup;
  }

  /**
   * Calculate estimated pickup/delivery times for a route
   */
  async calculateTimestamps(
    driver: Driver,
    route: DraftAssignment[]
  ): Promise<DraftAssignment[]> {
    let currentLocation = driver.lastKnownLocation;
    let currentTime = new Date();

    for (const assignment of route.sort((a, b) => a.sequence - b.sequence)) {
      // Travel to pickup
      const toPickup = await this.distanceCache.getDistance(
        currentLocation,
        assignment.order.pickupLocation
      );

      assignment.travelTimeToPickup = toPickup.duration / 60; // Convert to minutes
      currentTime = new Date(currentTime.getTime() + toPickup.duration * 1000);
      assignment.estimatedPickupTime = new Date(currentTime);

      // Travel to delivery
      const toDelivery = await this.distanceCache.getDistance(
        assignment.order.pickupLocation,
        assignment.order.dropoffLocation
      );

      assignment.travelTimeToDelivery = toDelivery.duration / 60;
      currentTime = new Date(currentTime.getTime() + toDelivery.duration * 1000);
      assignment.estimatedDeliveryTime = new Date(currentTime);

      // Update current location for next iteration
      currentLocation = assignment.order.dropoffLocation;
    }

    return route;
  }

  /**
   * Validate VRPPD constraint: pickup before delivery
   */
  validateVRPPD(route: DraftAssignment[]): boolean {
    const ordersMap = new Map<string, { pickupSeq: number; deliverySeq: number }>();

    for (const assignment of route) {
      const orderId = assignment.orderId;

      if (!ordersMap.has(orderId)) {
        ordersMap.set(orderId, { pickupSeq: -1, deliverySeq: -1 });
      }

      const orderData = ordersMap.get(orderId);

      // Determine if this is pickup or delivery stop
      if (assignment.metadata.previousStopLocation) {
        // This is delivery (has previous pickup)
        orderData.deliverySeq = assignment.sequence;
      } else {
        // This is pickup (no previous stop)
        orderData.pickupSeq = assignment.sequence;
      }
    }

    // Validate: all pickups before deliveries
    for (const [orderId, { pickupSeq, deliverySeq }] of ordersMap) {
      if (pickupSeq === -1 || deliverySeq === -1) {
        console.error(`Order ${orderId} missing pickup or delivery`);
        return false;
      }

      if (pickupSeq >= deliverySeq) {
        console.error(`Order ${orderId} pickup (${pickupSeq}) after delivery (${deliverySeq})`);
        return false;
      }
    }

    return true;
  }
}
```

---

## 5. Integration with Existing Matching Engine

### 5.1 Refactor MatchingEngine.draftBestAssignments()

**Before (using DraftMemory)**:
```typescript
async draftBestAssignments(): Promise<DraftMemoryStats> {
  const draftMemory = new DraftMemory();
  // ... in-memory calculation
  return draftMemory.getStatistics();
}
```

**After (using DraftService)**:
```typescript
async draftBestAssignments(): Promise<DraftGroup> {
  const orders = await this.getAvailableOrders();
  const drivers = await this.getAvailableDrivers();

  // Generate draft groups with algorithms
  const bestDraftGroup = await this.draftService.generateDraftGroups(
    orders,
    drivers,
    numGroups: 3 // Try 3 different solutions
  );

  return bestDraftGroup;
}
```

### 5.2 Update offerAssignments() to use DraftAssignments

```typescript
async offerAssignments(draftGroup: DraftGroup): Promise<void> {
  // Fetch all assignments in the winning draft group
  const draftAssignments = await this.draftRepo.find({
    where: { draftGroupId: draftGroup.id },
    relations: ['order', 'driver']
  });

  // Convert to OrderAssignments with OFFERED status
  for (const draft of draftAssignments) {
    await this.orderAssignmentService.createOfferedAssignment({
      orderId: draft.orderId,
      driverId: draft.driverId,
      sequence: draft.sequence,
      estimatedPickupTime: draft.estimatedPickupTime,
      estimatedDeliveryTime: draft.estimatedDeliveryTime,
      timeWindow: {
        pickup: {
          earliest: draft.estimatedPickupTime,
          latest: new Date(draft.estimatedPickupTime.getTime() + 15 * 60 * 1000)
        },
        delivery: {
          earliest: draft.estimatedDeliveryTime,
          latest: new Date(draft.estimatedDeliveryTime.getTime() + 15 * 60 * 1000)
        }
      }
    });
  }

  // Update Order status to OFFERED
  await this.orderRepo.update(
    { id: In(draftAssignments.map(d => d.orderId)) },
    { status: OrderStatus.OFFERED }
  );
}
```

---

## 6. Performance Optimizations

### 6.1 Expected Performance Metrics

| Scale | Orders | Drivers | Clarke-Wright | ALNS (2s limit) | Cache Hit Rate | Total Time | API Calls |
|-------|--------|---------|---------------|-----------------|----------------|------------|-----------|
| Small | 10 | 3 | 50ms | 500ms | 85% | 550ms | 5-10 |
| Medium | 30 | 5 | 100ms | 1500ms | 90% | 1600ms | 10-20 |
| Large | 50 | 10 | 150ms | 2000ms | 92% | 2150ms | 20-40 |

### 6.2 Cost Savings with Caching

**Without Cache**:
- 50 orders × 10 drivers = 500 location pairs
- 500 pairs × 500 API calls = 250,000 matrix elements/day
- Cost: $2/1,000 elements = **$500/day**

**With 90% Cache Hit Rate**:
- 500 pairs × 0.10 miss rate = 50 API calls
- 50 pairs × 50 = 2,500 matrix elements/day
- Cost: $2/1,000 elements = **$5/day**
- **Savings: $495/day (99% reduction)**

### 6.3 Database Query Optimization

```sql
-- Materialized view for fast draft group comparison
CREATE MATERIALIZED VIEW draft_group_summary AS
SELECT
  dg.id,
  dg.session_id,
  dg.total_travel_time,
  COUNT(da.id) as assignments_count,
  AVG(da.travel_time_to_pickup) as avg_pickup_time,
  AVG(da.travel_time_to_delivery) as avg_delivery_time
FROM draft_groups dg
LEFT JOIN draft_assignments da ON da.draft_group_id = dg.id
GROUP BY dg.id;

-- Refresh materialized view after draft generation
REFRESH MATERIALIZED VIEW draft_group_summary;
```

---

## 7. Testing Strategy

### 7.1 Unit Tests

- [ ] Clarke-Wright savings calculation accuracy
- [ ] ALNS operator selection and weight adaptation
- [ ] VRPPD constraint validation
- [ ] Distance cache key generation and retrieval
- [ ] Draft group comparison logic

### 7.2 Integration Tests

- [ ] End-to-end draft generation with database persistence
- [ ] Mapbox Matrix API batch requests
- [ ] Cache hit/miss scenarios
- [ ] Multi-group generation and selection

### 7.3 Performance Tests

- [ ] Benchmark Clarke-Wright with 10, 30, 50 orders
- [ ] Benchmark ALNS improvement time vs quality
- [ ] Cache effectiveness under load
- [ ] Database query performance with indexes

---

## 8. Migration Path

### Phase 1: Database Schema (Week 1)
1. Create migrations for DraftAssignments, DraftGroup, DistanceCache
2. Add indexes and spatial indexes
3. Test schema with sample data

### Phase 2: Algorithm Implementation (Week 2)
1. Implement Clarke-Wright Savings algorithm
2. Implement ALNS improvement
3. Unit test algorithms with synthetic data

### Phase 3: Caching System (Week 2)
1. Implement DistanceCacheService
2. Integrate Mapbox Matrix API
3. Add cache warming and cleanup jobs

### Phase 4: Integration (Week 3)
1. Refactor MatchingEngine.draftBestAssignments()
2. Update offerAssignments() to use DraftAssignments
3. Remove DraftMemory class
4. Integration testing

### Phase 5: Performance Tuning (Week 4)
1. Benchmark and optimize queries
2. Tune ALNS parameters
3. Load testing with production-like data
4. Monitor Mapbox API usage and costs

---

## 9. Monitoring and Observability

### 9.1 Key Metrics to Track

```typescript
// Add telemetry to DraftService
@Injectable()
export class DraftService {
  async generateDraftGroups(...): Promise<DraftGroup> {
    const startTime = Date.now();

    try {
      const result = await this.internalGenerate(...);

      // Log metrics
      this.metrics.histogram('draft_generation_time_ms', Date.now() - startTime);
      this.metrics.gauge('draft_group_total_time', result.totalTravelTime);
      this.metrics.counter('draft_groups_generated', 1);

      return result;
    } catch (error) {
      this.metrics.counter('draft_generation_errors', 1);
      throw error;
    }
  }
}

// Cache metrics
this.metrics.counter('cache_hits', cacheHit ? 1 : 0);
this.metrics.counter('cache_misses', cacheHit ? 0 : 1);
this.metrics.counter('mapbox_api_calls', 1);
```

### 9.2 Dashboard Visualizations

- Draft generation time distribution (p50, p95, p99)
- Algorithm quality scores over time
- Cache hit rate trends
- Mapbox API usage and cost tracking
- VRPPD constraint violations

---

## 10. Open Questions for Discussion

1. **Algorithm tuning**: Should we allow per-region algorithm selection? (e.g., Clarke-Wright for rural, ALNS for urban)

2. **Real-time updates**: How to handle new orders arriving during draft generation? Queue for next cycle or re-run immediately?

3. **Driver preferences**: Should we incorporate driver-specific preferences (avoid highways, prefer shorter routes)?

4. **Multi-objective optimization**: Balance between total time, fairness across drivers, and customer priority?

5. **Fallback strategy**: If ALNS times out, should we use Clarke-Wright result or fail gracefully?

6. **Cache invalidation**: Should we invalidate cache more aggressively during high-traffic periods?

---

## Summary

This plan replaces the in-memory DraftMemory system with a robust, database-persisted draft assignment system using proven VRPPD algorithms. The Clarke-Wright + ALNS hybrid approach provides 90-99% optimal solutions in under 2.5 seconds, while distance matrix caching reduces Mapbox API costs by 80-90%.

**Next Steps**:
1. Review and approve this plan
2. Answer open questions
3. Begin Phase 1 implementation (database schema)
