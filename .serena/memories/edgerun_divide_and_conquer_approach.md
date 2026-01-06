# EdgeRun Divide-and-Conquer Matching Engine

## Three-Stage Algorithm (From 03_ALGORITHM_DESIGN.md)

### STAGE 1: Territory Sectorization
**Purpose**: Assign orders to drivers based on proximity, naturally balancing workload

**Algorithm**:
```
For each order:
  1. Find available drivers with capacity < maxOrders
  2. Calculate distance from each driver's location to order
  3. Select driver with minimum distance
  4. Add order to driver's sector
```

**Complexity**: O(n × m) where n=orders, m=drivers  
**Output**: sectors[driver_id] = [orders]  
**Quality**: Naturally balanced, transparent, deterministic  

### STAGE 2: Driver Matching
**Purpose**: Assign drivers to orders (implicit in Stage 1)

**For real-time single order**:
```
1. Find drivers with available capacity
2. Among available, find closest to order
3. Assign if capacity allows
4. Try next closest if full
```

**Optional Scoring** (40% proximity, 30% reliability, 20% capacity, 10% vehicle fit)

**Complexity**: O(m) per order

### STAGE 3: Route Optimization
**Purpose**: Generate efficient delivery sequence per driver

#### Phase 3a: Nearest Neighbor (Initial Route)
```
1. Start at driver location
2. While unvisited orders remain:
   - Find closest unvisited order
   - Add to route
   - Mark visited
3. Return to start
```
**Complexity**: O(n²)  
**Quality**: 70-80% optimal  
**Speed**: Milliseconds for 20-100 stops

#### Phase 3b: 2-Opt Improvement
```
Repeat (up to 10 iterations):
  For each edge pair (i, i+1) and (j, j+1):
    If swapping improves: reverse segment [i+1:j], accept
    If no improvement found: stop
```
**Quality**: 10-20% improvement over NN  
**Still fast**: O(n² × iterations) but milliseconds  

## Pipeline Flow
```
orders[] + drivers[]
    ↓
[STAGE 1] Sectorization → sectors[driver_id][]
    ↓
[STAGE 2] Matching (implicit)
    ↓
[STAGE 3] Route Optimization
  For each driver:
    - Nearest Neighbor (initial)
    - 2-Opt (improve)
    ↓
optimized_routes[] with metrics
```

## Key Metrics (Success Criteria)
- **Total Distance**: Minimize
- **Workload Balance**: ±20% across drivers
- **Solution Quality**: 80-90% of theoretical optimal
- **Compute Time**: <1 second for 100 orders
- **2-Opt Improvement**: 10-20% reduction

## Implementation Timeline
- **Week 1**: Stage 1 + Stage 3a (~200 lines, 5 hours)
- **Week 2**: Stage 3b + testing (~300 lines, 5 hours)
- **Week 3**: Metrics + dashboard (~100 lines, 3 hours)

## Testing Strategy
- Stage 1: All orders assigned, no duplicates, capacity respected
- Stage 3a: Valid routes (start/end at depot)
- Stage 3b: 2-Opt improves distance by 5-20%
- Integration: Full pipeline with 50 orders, 5 drivers
