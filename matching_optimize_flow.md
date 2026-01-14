# /matching/optimize Endpoint Flow Documentation

This document details the execution flow when the `/matching/optimize` endpoint is called.

## 1. API Endpoint Entry Point

- **Endpoint**: `POST /matching/optimize`
- **Controller**: `MatchingController` (`src/controllers/matching/matching.controller.ts`)
- **Method**: `optimizeMatching`
- **Input**:
  - `verbose` (Query Param, boolean, default: `false`): Request detailed route waypoints.
- **Output**: `MatchingResponse`
  - `success`: boolean
  - `message`: string
  - `routes`: List of route summaries.
  - `summary`: High-level metrics (total routes, distance, computation time).

## 2. Main Orchestration (`matchingEngine.ts`)

The controller delegates to the matching engine.

- **Function**: `matchOrders(autoAccept: boolean = true)`
- **File**: `src/services/matching/matchingEngine.ts`
- **Logic**:
  1.  **Repository Setup**: Fetches all `PENDING` orders and `AVAILABLE` (or `EN_ROUTE_PICKUP`) drivers.
  2.  **Phase 1: Draft Optimization**: Calls `draftService.generateDraftGroups`.
  3.  **Phase 2: Offer Creation**: Calls `createOrderAssignmentsFromDraft` to persist offers.
  4.  **Phase 3: Auto-Accept**: Calls `autoAcceptAllOffers` (since `autoAccept` defaults to `true`).
  5.  **Response Building**: Calls `buildRoutesFromAssignments` to format return data.

## 3. Detailed Flow Steps

### Phase 1: Draft Optimization

- **Function**: `draftService.generateDraftGroups(orders, drivers, numGroups=3)`
- **File**: `src/services/matching/draftService.ts`
- **Input**:
  - `orders`: List of pending `Order` entities.
  - `drivers`: List of available `Driver` entities.
  - `numGroups`: Number of solutions to generate (default 3).
- **Process**:
  - Generates 3 solutions using different strategies in parallel:
    1.  **Pure Clarke-Wright**: `clarkeWrightSolver.solve(...)`
    2.  **Clarke-Wright + ALNS (2s)**: `clarkeWrightSolver.solve(...)` -> `alnsSolver.improve(..., timeout=2000ms)`
    3.  **Clarke-Wright + ALNS (5s)**: `clarkeWrightSolver.solve(...)` -> `alnsSolver.improve(..., timeout=5000ms)`
  - **Validation**: Each group is validated for VRPPD constraints (e.g., Pickup before Delivery, correct time formatting).
  - **Persistence**: Saves `DraftGroup` and `DraftAssignment` entities to the database.
  - **Selection**: Selects the group with the minimum `totalTravelTime` as the winner.
- **Output**: The selected best `DraftGroup` entity (loaded with relations).

### Phase 2: Offer Persistence

- **Function**: `createOrderAssignmentsFromDraft(draftGroup)`
- **File**: `src/services/matching/matchingEngine.ts` (helper)
- **Process**:
  - Iterates through each assignment in the selected `DraftGroup`.
  - **Call**: `orderAssignmentService.createOfferedAssignment`
    - Creates `OrderAssignment` record with status `OFFERED`.
    - Sets `offerRound = 1`.
  - Updates `Order` status to `OFFERED`.
- **Output**: Count of persisted offers.

### Phase 3: Auto-Accept (Simulation)

- **Function**: `autoAcceptAllOffers()`
- **File**: `src/services/matching/matchingEngine.ts` (helper)
- **Process**:
  - Fetches all `OFFERED` assignments from `OrderAssignment` repo.
  - Updates `OrderAssignment` status to `ACCEPTED`.
  - Updates `Order` status: `OFFERED` -> `ASSIGNED`.
  - Updates `Driver` status: `AVAILABLE` -> `EN_ROUTE_PICKUP` (only if currently AVAILABLE).
- **Output**: Count of accepted offers.

### Response Construction

- **Function**: `buildRoutesFromAssignments(autoAccept)`
- **File**: `src/services/matching/matchingEngine.ts` (helper)
- **Process**:
  - Queries `OrderAssignment` records based on status (ACCEPTED/COMPLETED if autoAccept, OFFERED otherwise).
  - Groups assignments by `driverId`.
  - Constructs `OptimizedRoute` objects.
  - **Calculations**: Calls `calculateRouteTotalDistance` (using helper) for each route.
- **Output**: Array of `OptimizedRoute` objects returned to the Controller.

## 4. Key Data Structures

### MatchingResponse (API)

```typescript
interface MatchingResponse {
  success: boolean;
  message: string;
  routes: RouteInfo[];
  summary: {
    totalRoutes: number;
    totalOrders: number;
    totalAssigned: number;
    totalDistance: number;
    computationTimeMs: number;
    timestamp: string;
  };
}
```

### OptimizedRoute (Internal)

```typescript
interface OptimizedRoute {
  driverId: string;
  driverName: string;
  orders: Order[];
  sequence: Location[]; // Waypoints
  stops: Stop[]; // Detailed stop info (pickup/delivery)
  totalDistance: number;
  metrics: {
    orderCount: number;
    distancePerOrder: number;
  };
  timeWindows?: (TimeWindowData | null)[];
}
```
