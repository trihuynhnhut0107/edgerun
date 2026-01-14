# Matching Engine Flow Analysis

## Complete Function Inventory

### Primary Entry Points
1. **`matchOrders(autoAccept: boolean)`** (Line 1473)
   - Main entry point called by `/optimize` endpoint
   - Handles multi-round matching with rejection handling
   - Uses: Clarke-Wright + ALNS algorithms via draftService

2. **`runMatchingCycle()`** (Line 1403)
   - Alternative entry point for full Draft→Offer→Wait→Process cycle
   - Loops until all orders assigned or max rounds reached
   - Uses: `draftBestAssignments()`, `offerAssignments()`, `processResponses()`

### Core Workflow Functions

#### Phase 1: Draft (Planning)
3. **`draftBestAssignments(offerRound: number)`** (Line 1123)
   - Region-based matching using PostGIS
   - Filters rejected drivers
   - Uses DraftMemory for intelligent scoring
   - Returns: `DraftResult[]`

#### Phase 2: Offer (Persistence)
4. **`offerAssignments(drafts, offerRound)`** (Line 1284)
   - Persists drafts as OFFERED assignments
   - Calls: `orderAssignmentService.createOfferedAssignment()`
   - Updates: Order status → OFFERED (inside service)

#### Phase 3: Wait (Driver Response)
5. **`waitForResponses(waitTimeMs)`** (Line 1324)
   - Simple delay for driver responses
   - Default: 3 minutes

#### Phase 4: Process (Acceptance/Rejection)
6. **`processResponses()`** (Line 1335)
   - Expires stale offers
   - Counts accepted/rejected
   - Returns: `{ accepted, rejected, expired }`

### Supporting Functions

#### Data Retrieval
7. **`getPendingOrders()`** (Line 201)
   - Fetches orders with status = PENDING
   - Sorted by priority DESC, createdAt ASC

8. **`getAvailableDrivers()`** (Line 220)
   - Fetches drivers with status: AVAILABLE, EN_ROUTE_*, AT_*
   - Returns drivers with current GPS locations

9. **`getDriverCurrentRoute(driverId)`** (Line 1058)
   - Fetches active assignments for a driver
   - Returns: `Stop[]` (pickup + delivery stops)

10. **`getPendingOrderStats()`** (Line 1372)
    - Analytics function for monitoring
    - Returns: rejected order counts, priority boosts

#### Routing Algorithms (Legacy - NOT USED by matchOrders)
11. **`sectorizeOrders(orders, drivers)`** (Line 98)
    - Territory sectorization
    - NOT USED: matchOrders uses Clarke-Wright instead

12. **`nearestNeighbor(orders, startLocation)`** (Line 262)
    - Initial route generation
    - NOT USED: matchOrders uses Clarke-Wright instead

13. **`twoOpt(route, maxIterations)`** (Line 337)
    - Route optimization
    - NOT USED: matchOrders uses ALNS instead

14. **`optimizeAllRoutes(sectors)`** (Line 398)
    - Orchestrates nearestNeighbor + twoOpt
    - NOT USED: matchOrders uses draftService

15. **`saveAssignments(optimizedRoutes)`** (Line 775)
    - Persists assignments from optimized routes
    - NOT USED: matchOrders uses createOrderAssignmentsFromDraft

#### Insertion Logic
16. **`calculateBestInsertion(order, currentRoute, driverLocation)`** (Line 920)
    - Finds optimal insertion position for an order
    - USED by: draftBestAssignments (for continuous insertion)
    - Returns: `InsertionResult` with cost, positions, ETAs

### Internal Helper Functions (NOT exported)
17. **`createOrderAssignmentsFromDraft(draftGroup)`** (Line 1610)
    - Converts DraftGroup → OrderAssignments
    - Calls: `orderAssignmentService.createOfferedAssignment()`

18. **`buildRoutesFromAssignments(autoAccept)`** (Line 1641)
    - Builds API response from database assignments
    - Groups by driver, calculates metrics

19. **`autoAcceptAllOffers()`** (Line 1718)
    - Testing function: simulates driver responses
    - 80% accept rate, 20% reject rate

---

## Flow Trace

### Flow A: `/optimize` Endpoint (Current Production)

```
┌─────────────────────────────────────────────────────────────────┐
│ POST /matching/optimize                                         │
└───────────────┬─────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ matchOrders(autoAccept=true)                                      │
│                                                                   │
│ ROUND 1:                                                          │
│   1. getPendingOrders() → Order[] (status: PENDING)              │
│   2. getAvailableDrivers() → DriverWithLocation[]                │
│   3. draftService.generateDraftGroups() → DraftGroup             │
│      - Uses Clarke-Wright + ALNS algorithms                      │
│      - Respects order.rejectedDriverIds[] filtering              │
│   4. createOrderAssignmentsFromDraft(draftGroup)                 │
│      → orderAssignmentService.createOfferedAssignment()          │
│      → Order status: PENDING → OFFERED ✅                        │
│   5. autoAcceptAllOffers() (testing mode)                        │
│      - 80%: acceptAssignment() → Order status: OFFERED → ASSIGNED│
│      - 20%: rejectAssignment() → Order status: OFFERED → PENDING │
│                                                                   │
│ ROUND 2 (if rejections):                                          │
│   6. getPendingOrders() → includes rejected orders               │
│      - Orders have +20% priority boost                           │
│      - rejectedDriverIds[] populated                             │
│   7. draftService.generateDraftGroups() → filters drivers        │
│   8. Repeat steps 4-5                                            │
│                                                                   │
│ Loop until: all assigned OR max rounds (5)                       │
└───────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ buildRoutesFromAssignments(autoAccept=true)                      │
│   → Query assignments with status: ACCEPTED/COMPLETED            │
│   → Group by driver                                              │
│   → Calculate metrics                                            │
└───────────────────────────────────────────────────────────────────┘
                │
                ▼
┌───────────────────────────────────────────────────────────────────┐
│ Return OptimizedRoute[] to API                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Flow B: `runMatchingCycle()` (Alternative - Manual Testing)

```
┌─────────────────────────────────────────────────────────────────┐
│ runMatchingCycle()                                              │
│                                                                 │
│ ROUND 1:                                                        │
│   1. draftBestAssignments(offerRound=1)                        │
│      - getPendingOrders() → Order[] (status: PENDING)          │
│      - getAvailableDrivers() → DriverWithLocation[]            │
│      - RegionService.groupByRegion() → Region[]                │
│      - For each order in each region:                          │
│        * Filter: !order.rejectedDriverIds.includes(driverId)   │
│        * getDriverCurrentRoute(driverId) → Stop[]              │
│        * calculateBestInsertion() → InsertionResult            │
│      - DraftMemory.selectBestDrafts() → DraftResult[]          │
│                                                                 │
│   2. offerAssignments(drafts, offerRound=1)                    │
│      → orderAssignmentService.createOfferedAssignment()        │
│      → Order status: PENDING → OFFERED ✅                      │
│                                                                 │
│   3. waitForResponses(3 minutes)                               │
│                                                                 │
│   4. processResponses()                                        │
│      - expireStaleOffers() → OFFERED → EXPIRED                 │
│        → Order status: OFFERED → PENDING                       │
│      - Count: accepted, rejected, expired                      │
│                                                                 │
│ ROUND 2 (if rejected + expired > 0):                            │
│   5. Repeat steps 1-4                                          │
│                                                                 │
│ Loop until: no rejections/expirations OR max rounds (10)       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Order Status Transitions (Verified)

### State Machine

```
┌──────────┐
│ PENDING  │ ← Initial state (new orders)
└────┬─────┘
     │ createOfferedAssignment()
     ▼
┌──────────┐
│ OFFERED  │ ← Assignment created, awaiting driver response
└────┬─────┘
     │
     ├─── acceptAssignment() ───→ ┌──────────┐
     │                             │ ASSIGNED │ ← Driver accepted
     │                             └──────────┘
     │
     ├─── rejectAssignment() ───→ ┌──────────┐
     │                             │ PENDING  │ ← Back to queue (+20% priority)
     │                             └──────────┘
     │
     └─── expireStaleOffers() ──→ ┌──────────┐
                                   │ PENDING  │ ← Timeout, back to queue
                                   └──────────┘
```

### Transition Details

| Transition | Function | Order Status Change | Assignment Status | Notes |
|------------|----------|-------------------|------------------|-------|
| **Offer Created** | `createOfferedAssignment()` | PENDING → OFFERED | OFFERED | Atomic transaction ✅ |
| **Driver Accepts** | `acceptAssignment()` | OFFERED → ASSIGNED | ACCEPTED | Atomic transaction ✅ |
| **Driver Rejects** | `rejectAssignment()` | OFFERED → PENDING | REJECTED | +20% priority, add to rejectedDriverIds[] ✅ |
| **Offer Expires** | `expireStaleOffers()` | OFFERED → PENDING | EXPIRED | Same as rejection ✅ |

### Verification Points

✅ **All transitions are atomic** (using TypeORM transactions)
✅ **Order status matches assignment lifecycle**
✅ **Rejected orders return to PENDING** for re-drafting
✅ **Priority boost applied** on rejection (+20% per rejection)
✅ **Driver filtering works** (rejectedDriverIds[] enforced in Clarke-Wright + ALNS)

---

## Issues Found

### 🔴 CRITICAL: Redundant/Unused Functions

The following functions are **NOT USED** by the current production flow (`matchOrders`):

1. **`sectorizeOrders()`** (Line 98)
   - Purpose: Territory sectorization
   - **Issue**: Replaced by Clarke-Wright algorithm in draftService
   - **Action**: Mark as deprecated or remove

2. **`nearestNeighbor()`** (Line 262)
   - Purpose: Initial route generation
   - **Issue**: Replaced by Clarke-Wright savings algorithm
   - **Action**: Mark as deprecated or remove

3. **`twoOpt()`** (Line 337)
   - Purpose: Route optimization
   - **Issue**: Replaced by ALNS metaheuristic
   - **Action**: Mark as deprecated or remove

4. **`optimizeAllRoutes()`** (Line 398)
   - Purpose: Orchestrates nearestNeighbor + twoOpt
   - **Issue**: Replaced by draftService.generateDraftGroups()
   - **Action**: Mark as deprecated or remove

5. **`saveAssignments()`** (Line 775)
   - Purpose: Persist assignments from optimized routes
   - **Issue**: Replaced by createOrderAssignmentsFromDraft()
   - **Action**: Mark as deprecated or remove

### 🟡 WARNING: Overlapping Functionality

**Overlap 1: Two Entry Points**
- `matchOrders()` (uses draftService)
- `runMatchingCycle()` (uses draftBestAssignments)

**Recommendation**: Choose one primary entry point
- **Option A**: Keep `matchOrders()` (better algorithm: Clarke-Wright + ALNS)
- **Option B**: Deprecate `runMatchingCycle()` (uses older insertion-based approach)

**Overlap 2: Two Draft Methods**
- `draftService.generateDraftGroups()` (Clarke-Wright + ALNS)
- `draftBestAssignments()` (Best insertion with DraftMemory)

**Recommendation**:
- Keep both if they serve different use cases
- `draftService`: Batch optimization (all orders at once)
- `draftBestAssignments()`: Continuous insertion (orders arriving in real-time)

### ✅ VERIFIED: Order Status Transitions

All order status transitions are correct and atomic:
- PENDING → OFFERED ✅ (in `createOfferedAssignment`)
- OFFERED → ASSIGNED ✅ (in `acceptAssignment`)
- OFFERED → PENDING ✅ (in `rejectAssignment` and `expireStaleOffers`)

No gaps or inconsistencies found.

---

## Recommendations

### 1. Clean Up Unused Functions
```typescript
// Mark as deprecated
/** @deprecated Use draftService.generateDraftGroups() instead */
export async function sectorizeOrders(...) { ... }

/** @deprecated Use draftService (Clarke-Wright + ALNS) instead */
export async function nearestNeighbor(...) { ... }

/** @deprecated Use draftService (ALNS) instead */
export async function twoOpt(...) { ... }

/** @deprecated Use draftService.generateDraftGroups() instead */
export async function optimizeAllRoutes(...) { ... }

/** @deprecated Use createOrderAssignmentsFromDraft() instead */
export async function saveAssignments(...) { ... }
```

### 2. Consolidate Entry Points

**Recommended Primary Flow**: `matchOrders()`
- Better algorithms (Clarke-Wright + ALNS)
- Multi-round rejection handling ✅
- Cleaner implementation

**Secondary Flow**: `runMatchingCycle()`
- Keep for manual testing
- Uses continuous insertion approach
- Good for real-time order insertion

### 3. Add Flow Documentation

Create `MATCHING_ENGINE_ARCHITECTURE.md` with:
- Current vs deprecated functions
- Flow diagrams
- When to use each entry point
- Order status state machine

### 4. Add Validation Tests

```typescript
describe('Order Status Transitions', () => {
  it('should transition PENDING → OFFERED → ASSIGNED', async () => {
    // Test accept flow
  });

  it('should transition PENDING → OFFERED → PENDING on rejection', async () => {
    // Test reject flow with priority boost
  });

  it('should filter rejected drivers in next round', async () => {
    // Test rejectedDriverIds filtering
  });
});
```

---

## Summary

### ✅ What's Working
- Order status transitions are **atomic and correct**
- Rejection handling works (priority boost, driver filtering)
- Multi-round matching handles rejected orders properly

### ⚠️ What Needs Attention
- **5 unused/deprecated functions** cluttering the codebase
- **2 overlapping entry points** (matchOrders vs runMatchingCycle)
- **2 draft methods** (draftService vs draftBestAssignments)
- Missing documentation on which functions to use

### 🎯 Priority Actions
1. **High**: Mark deprecated functions with @deprecated tags
2. **High**: Document primary vs secondary flows
3. **Medium**: Add order status transition tests
4. **Medium**: Create architecture documentation
5. **Low**: Consider removing deprecated code in future release
