# EdgeRun - Last-Mile Delivery Backend

## Project Overview

**EdgeRun** is a minimal last-mile delivery system focused on solving the core driver-order matching problem for food delivery operations.

## Design Philosophy

- **Simple First**: Start with working solution, optimize later
- **Local Development**: PostgreSQL + PostGIS, no cloud dependencies
- **Simulation-Driven**: Test algorithms with realistic scenarios before production
- **Algorithm-Focused**: Perfect the matching logic, not infrastructure scaling

## Core Problem Statement

**How do we assign incoming orders to available drivers in real-time to minimize:**
- Customer wait time (order → delivery)
- Driver idle time (between deliveries)
- Total distance traveled (cost efficiency)

## Target Use Case

**Food & Restaurant Delivery** - chosen because:
- Time-sensitive (30-60 min delivery windows)
- Dynamic conditions (continuous order stream)
- Clear constraints (food temperature, customer expectations)
- High algorithm impact (small improvements = big business value)

## System Scope

### In Scope
- Driver-order matching algorithm
- Multi-stop route optimization
- Real-time driver state management
- Geospatial proximity queries
- Simulation framework for testing

### Out of Scope (MVP)
- Payment processing
- Restaurant/customer apps
- Authentication/authorization
- Multi-city coordination
- Mobile driver app (simulation uses API)
- Real-time tracking UI

## Success Metrics

- **Assignment Speed**: <500ms from order arrival to driver assignment
- **Algorithm Quality**: 90%+ on-time delivery rate in simulations
- **Driver Utilization**: 70%+ active time (not idle)
- **ETA Accuracy**: ±5 min variance from predicted delivery time

## Technology Stack

```yaml
Language: TypeScript 5+
Runtime: Node.js 20+
Framework: Express.js
ORM: TypeORM
API Documentation: TSOA + Swagger
Database: PostgreSQL 15 + PostGIS 3.3
Geospatial: PostGIS 3.3
Routing: OSRM (local Docker instance)
Testing: Jest + simulation framework
Cache: Redis 7+ (optional)
```

## Project Structure

```
edgerun/
├── src/
│   ├── routes/           # Express route handlers
│   ├── services/         # Business logic
│   │   ├── matching/     # Matching algorithm
│   │   ├── routing/      # Route optimization
│   │   └── state/        # Driver state management
│   ├── models/           # TypeScript interfaces & types
│   ├── db/               # Database connection & utilities
│   ├── simulation/       # Testing framework
│   ├── documents/        # Project documentation
│   └── index.ts          # Express app entry point
├── tests/
├── docker-compose.yml    # PostgreSQL + PostGIS + OSRM
├── package.json
└── tsconfig.json
```

## Documentation Index

1. [System Architecture](./01_ARCHITECTURE.md)
2. [Matching Algorithm](./02_MATCHING_ALGORITHM.md)
3. [Route Optimization](./03_ROUTE_OPTIMIZATION.md)
4. [Data Models](./04_DATA_MODELS.md)
5. [Implementation Plan](./05_IMPLEMENTATION_PLAN.md)
6. [Region Selection](./06_REGION_SELECTION.md)
7. [Simulation Framework](./07_SIMULATION_FRAMEWORK.md)

## Quick Start

See [Implementation Plan](./05_IMPLEMENTATION_PLAN.md) for step-by-step build instructions.
