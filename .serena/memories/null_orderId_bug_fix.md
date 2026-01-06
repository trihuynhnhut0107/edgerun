# Null orderId Bug Fix

## Problem
```
error: null value in column "orderId" of relation "order_assignments" violates not-null constraint
query: UPDATE "order_assignments" SET "orderId" = $1 WHERE "id" = $2 -- PARAMETERS: [null,"..."]
```

## Root Cause
The Order entity had `cascade: true` on the OrderAssignment relationship:

```typescript
@OneToOne(() => OrderAssignment, (assignment) => assignment.order, {
  cascade: true,  // ← PROBLEM
  eager: true,
})
assignment?: OrderAssignment;
```

### Why This Caused the Bug

1. `getPendingOrders()` uses eager loading: loads Order with assignment relationship
2. Pending orders have `assignment = undefined` (not assigned yet)
3. `orderRepo.save(order)` in OrderAssignmentService triggered cascading save
4. TypeORM tried to cascade-save `assignment = undefined`
5. This resulted in UPDATE with `orderId = null`
6. Constraint violation: `orderId` column NOT NULL

## Solution
Removed `cascade: true` from Order entity - assignments must be managed independently:

```typescript
@OneToOne(() => OrderAssignment, (assignment) => assignment.order, {
  eager: true,
})
assignment?: OrderAssignment;
```

## Why This Works
- OrderAssignmentService explicitly manages assignment creation and updates
- Order saves don't attempt to cascade-modify assignments
- No null values will be written to existing assignment records
- Order status updates work independently of assignment lifecycle

## Files Changed
- src/entities/Order.ts: Removed cascade: true

## Impact
- ✅ Fixes null orderId constraint violation
- ✅ OrderAssignmentService remains source of truth for assignments
- ✅ No breaking changes to existing functionality
- ✅ Better separation of concerns
