# Phase 1 VRPPD Implementation - Next Steps

## Current Status
✅ Foundation complete with VRPPD-ready data structures
🔄 Ready to implement PyVRP integration

---

## Remaining Tasks for MVP Completion

### Task 1: Create PyVRP Wrapper (Priority: CRITICAL)

**File**: `src/services/routing/pyvrpWrapper.ts` (NEW)

**Responsibilities**:
1. Convert EdgeRun orders to PyVRP format
2. Convert EdgeRun drivers to PyVRP vehicles
3. Call PyVRP solver with constraints
4. Convert solution back to OptimizedRoute format

**Key Methods**:
```typescript
class PyVRPWrapper {
  // Convert orders to PyVRP shipments (pickup + delivery pairs)
  private ordersToShipments(orders: Order[]): PyVRP.Shipment[]

  // Convert drivers to PyVRP vehicles
  private driversToVehicles(drivers: Driver[]): PyVRP.Vehicle[]

  // Call PyVRP solver
  async optimizeRoutes(
    orders: Order[],
    drivers: Driver[]
  ): Promise<OptimizedRoute[]>

  // Extract routes from PyVRP solution
  private extractRoutes(solution: PyVRP.Solution): OptimizedRoute[]
}
```

**Integration Point**:
```typescript
// In optimizeAllRoutes(), replace nearestNeighbor() call:

// OLD:
let route = await nearestNeighbor(sector.orders, sector.driverLocation);

// NEW (when using PyVRP):
const pyvrpWrapper = new PyVRPWrapper();
const optimizedRoutes = await pyvrpWrapper.optimizeRoutes(
  allOrders,
  allDrivers
);
```

**Dependencies**:
- Install: `pip install pyvrp` (or use Python subprocess)
- Python integration library for Node.js
- Error handling for PyVRP unavailability

---

### Task 2: Optional - Implement Batched Nearest Neighbor

**File**: `src/services/matching/matchingEngine.ts` (UPDATE nearestNeighbor)

**Purpose**: If PyVRP unavailable, use intelligent batching heuristic

**Algorithm**:
```
1. Create dual-stop list: [Pick₁, Pick₂, ... Deliv₁, Deliv₂, ...]
2. Use nearest neighbor on dual-stop list
3. Ensure pickup stops before corresponding delivery stops
4. Validate precedence constraints

Result: Routes with multiple pickups followed by deliveries
```

**Note**: This is optional for MVP if PyVRP is mandatory

---

### Task 3: Integration Tests

**File**: `src/services/matching/__tests__/matchingEngine.test.ts` (ADD)

**New Test Suite**: "VRPPD End-to-End Integration"

**Tests to Add**:
1. **Test PyVRP Integration**
   ```typescript
   test('should optimize routes with PyVRP', async () => {
     const orders = [/* test orders */];
     const drivers = [/* test drivers */];

     const routes = await pyvrpWrapper.optimizeRoutes(orders, drivers);

     expect(routes).toBeDefined();
     expect(routes[0].stops).toBeDefined();
     expect(routes[0].stops.length).toBeGreaterThan(0);
   });
   ```

2. **Test Distance Reduction**
   ```typescript
   test('should reduce distance vs sequential routing', async () => {
     // Compare batched vs sequential routing
     const sequentialDistance = calculateSequentialDistance(orders);
     const batchedDistance = calculateBatchedDistance(orders);

     const reduction = (sequentialDistance - batchedDistance) / sequentialDistance;
     expect(reduction).toBeGreaterThan(0.15); // 15%+ reduction
   });
   ```

3. **Test Time Windows**
   ```typescript
   test('should generate cumulative time windows', async () => {
     const route = await optimizeRoute(sector);

     expect(route.timeWindows).toBeDefined();
     expect(route.timeWindows.length).toBe(route.stops.length);

     // Verify monotonic increase
     for (let i = 1; i < route.timeWindows.length; i++) {
       expect(route.timeWindows[i].expectedArrival)
         .toBeGreaterThan(route.timeWindows[i-1].expectedArrival);
     }
   });
   ```

---

## Testing Strategy

### Unit Tests
- ✅ Stop structure validation
- ✅ Precedence constraint validation
- ✅ Cumulative time calculation
- 🔄 PyVRP conversion functions
- 🔄 PyVRP solution extraction

### Integration Tests
- 🔄 End-to-end routing pipeline
- 🔄 Distance reduction vs current algorithm
- 🔄 Time window generation
- 🔄 Error handling and fallbacks

### Performance Tests
- Target: <5 seconds for 100 orders
- Measure: PyVRP solving time
- Baseline: Current nearest neighbor time

---

## Expected Results

### Successful MVP Completion
- ✅ Routes include pickup and delivery stops
- ✅ Multiple pickups can precede multiple deliveries
- ✅ Time windows calculated cumulatively
- ✅ Precedence constraints validated
- ✅ **20-30% distance reduction** vs current algorithm
- ✅ All tests passing

### Metrics to Track
- Average route distance (km) - target: 20-30% reduction
- Orders per driver per hour - target: 10-15% increase
- Optimization time - target: <5 seconds for 100 orders
- Test coverage - target: >90%

---

## Risk Mitigation

### Risk: PyVRP Not Available
- **Mitigation**: Fallback to batched nearest neighbor
- **Plan**: Keep `nearestNeighbor()` as fallback algorithm

### Risk: Time Windows Invalid After Batching
- **Mitigation**: Validate precedence constraints
- **Catch**: `validatePickupBeforeDelivery()` enforces this

### Risk: Performance Degradation
- **Mitigation**: Cache PyVRP results for similar order sets
- **Monitor**: Track optimization time per batch

---

## Success Checklist

Before moving to Phase 2, verify:

- [ ] PyVRP wrapper implemented and tested
- [ ] Routes show 20%+ distance reduction
- [ ] All time windows respect precedence
- [ ] Optimization completes in <5 seconds
- [ ] All 17+ tests passing
- [ ] No TypeScript warnings/errors
- [ ] Commit with clear VRPPD implementation message

---

## Files to Create/Modify

### NEW Files
- `src/services/routing/pyvrpWrapper.ts` - PyVRP integration

### MODIFIED Files
- `src/services/matching/matchingEngine.ts` - Already updated ✅
- `src/services/matching/__tests__/matchingEngine.test.ts` - Add integration tests

### REFERENCE Files
- `src/documents/BATCHED_DELIVERY_ROUTING.md` - PyVRP integration section
- `src/documents/VRPPD_ALGORITHM_REFERENCE.md` - PyVRP code examples

---

## Quick Start Template

### PyVRP Wrapper Structure
```typescript
import { Order } from '../../entities/Order';
import { Driver } from '../../entities/Driver';
import { OptimizedRoute } from '../matching/matchingEngine';

export class PyVRPWrapper {
  private modelConfig: PyVRPModelConfig = {
    maxCapacityPerDriver: 5,
    maxTimePerRoute: 480, // 8 hours
    defaultSpeed: 35, // km/h
    useTimeWindows: true,
  };

  async optimizeRoutes(
    orders: Order[],
    drivers: Driver[]
  ): Promise<OptimizedRoute[]> {
    // 1. Validate inputs
    // 2. Convert to PyVRP format
    // 3. Create PyVRP model
    // 4. Call solver
    // 5. Convert back to OptimizedRoute
    // 6. Validate constraints
    // 7. Return routes
  }
}
```

---

## Documentation References

- **Algorithm Details**: See `VRPPD_ALGORITHM_REFERENCE.md` sections:
  - "Nearest Neighbor with Batching" (line 16-74)
  - "Hybrid Genetic Search (HGS)" (line 88-157)
  - "Integration with PyVRP" (line 349-409)

- **Implementation Guide**: See `IMPLEMENTATION_ROADMAP.md` section:
  - "Phase 1: MVP Implementation" (line 87-318)
  - "PyVRP Integration Wrapper" (line 94-116)
  - "Files Modified (Phase 1)" (line 236-259)

---

## Estimated Timeline

| Task | Effort | Depends On |
|------|--------|-----------|
| PyVRP wrapper | 1-2 days | Setup, API study |
| Integration tests | 1 day | Wrapper complete |
| Performance tuning | 0.5 day | Tests passing |
| Documentation | 0.5 day | Everything done |
| **TOTAL** | **3-4 days** | **MVP GOAL** |

---

**Status**: Foundation COMPLETE ✅ - Ready to proceed with PyVRP integration
**Next Session**: Implement PyVRP wrapper and test end-to-end
