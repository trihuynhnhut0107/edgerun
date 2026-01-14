# Matching Algorithm

## Overview

Orders are matched to drivers in two stages:
1. **Clarke-Wright** builds an initial solution fast (~100ms)
2. **ALNS** improves it iteratively (2-5 seconds)

The system runs 3 variations and picks the best result.

---

## Stage 1: Clarke-Wright Savings

**File**: `src/services/matching/clarkeWrightSolver.ts`

Builds routes by merging orders that are close together.

### How It Works

1. Set a virtual depot at the center of all pickups
2. Calculate "savings" for each pair of orders — how much distance we save by serving them together
3. Sort pairs by highest savings
4. Greedily merge routes while respecting capacity

### Key Numbers

| Value | Location | Purpose |
|-------|----------|---------|
| Depot = centroid | `setDepotFromOrders()` | Reference point for savings calculation |

**Output**: 85-95% optimal solution in ~100ms

---

## Stage 2: ALNS (Adaptive Large Neighborhood Search)

**File**: `src/services/matching/alnsSolver.ts`

Improves the initial solution by repeatedly removing and reinserting orders.

### How It Works

Each iteration:
1. **Destroy**: Remove some orders from routes
2. **Repair**: Reinsert them in better positions
3. **Accept/Reject**: Keep the change based on simulated annealing

### Destroy Operators

| Operator | What it does |
|----------|--------------|
| `random_removal` | Removes random orders |
| `worst_removal` | Removes orders causing longest detours |
| `related_removal` | Removes nearby orders as a cluster |

### Repair Operators

| Operator | What it does |
|----------|--------------|
| `greedy_insert` | Insert at cheapest position |
| `regret_insert` | Prioritize orders with few good options |

### Key Numbers

| Value | Variable | Purpose |
|-------|----------|---------|
| `0.15` (15%) | `DESTROY_PERCENTAGE` | Fraction of orders removed each iteration. Too low = slow progress. Too high = loses good structure. |
| `0.995` | `COOLING_RATE` | Temperature drops 0.5% per iteration. Controls how quickly we stop accepting worse solutions. |
| `1.5` | `WEIGHT_UPDATE_FACTOR` | Successful operators get 1.5x weight boost. Lets algorithm learn what works. |
| `50` | `maxNoImprovement` | Stop after 50 iterations without improvement. Prevents wasting time when converged. |
| `10,000` | Unassigned penalty | Cost added per unassigned order. Forces algorithm to assign everything. |
| `0.05` | Initial temperature | Set to 5% of initial cost. Allows ~5% worse solutions early on. |

**Output**: 95-99% optimal solution in 2-5 seconds

---

## Draft Service

**File**: `src/services/matching/draftService.ts`

Runs multiple strategies and picks the best.

### Key Numbers

| Value | Purpose |
|-------|---------|
| `3` groups | Number of draft solutions generated |
| `2000ms` | ALNS time limit for group 2 |
| `5000ms` | ALNS time limit for group 3 |

### Strategy Per Group

```
Group 0: Pure Clarke-Wright (fastest)
Group 1: Clarke-Wright + ALNS 2s (balanced)
Group 2: Clarke-Wright + ALNS 5s (best quality)
```

Winner = lowest total distance that passes VRPPD validation.

---

## VRPPD Constraints

**Hard rules** (cannot violate):
- Pickup before delivery for each order
- Never exceed driver's `maxOrders` capacity
- Same driver handles pickup and delivery

**Soft rules** (penalized):
- Unassigned orders: 10,000 penalty each
- Time window violations: weighted penalty

---

## Entry Points

| Function | File | Purpose |
|----------|------|---------|
| `matchOrders()` | `matchingEngine.ts` | Main entry — triggers full matching flow |
| `generateDraftGroups()` | `draftService.ts` | Generates and selects best draft |
| `solve()` | `clarkeWrightSolver.ts` | Builds initial solution |
| `improve()` | `alnsSolver.ts` | Optimizes existing solution |
