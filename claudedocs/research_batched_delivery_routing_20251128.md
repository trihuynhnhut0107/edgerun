# Batched Delivery Routing Algorithms: Comprehensive Research Report

**Research Date**: November 28, 2025
**Focus**: Algorithms optimizing multiple pickups followed by multiple deliveries (batch consolidation)
**Use Case**: EdgeRun delivery platform optimization

---

## Executive Summary

Batched delivery routing is a well-studied variant of the Vehicle Routing Problem (VRP) known as the **Pickup and Delivery Problem (PDP)** or **Vehicle Routing Problem with Pickup and Delivery (VRPPD)**. Unlike traditional Traveling Salesman Problem (TSP) which focuses on visiting nodes, batched routing requires:

- **Capacity constraints** (vehicle load limits)
- **Precedence constraints** (pickup before delivery)
- **Time window constraints** (customer availability)
- **Pairing constraints** (specific pickup-delivery relationships)
- **Multi-stop consolidation** (batching multiple orders per route)

**Key Finding**: Modern implementations use **Hybrid Genetic Search (HGS)** combined with **Large Neighborhood Search (LNS)** and **Mixed Integer Programming (MIP)** to achieve near-optimal solutions (within 0.5-1% of optimum) for instances with hundreds or thousands of delivery points.

---

## 1. Academic Algorithms & Research Papers

### 1.1 Core Algorithm Families

#### **Vehicle Routing Problem with Pickup and Delivery (VRPPD)**
The fundamental framework where vehicles must transport goods from pickup locations to delivery locations with various constraints.

**Key Research Papers**:
- *"VRP with Pickup and Delivery"* - Desaulniers & Desrosiers (foundational work on VRPPD formulations)
- *"Hybrid Genetic Search for the CVRP"* (2021) - State-of-the-art metaheuristic achieving leading performance
- *"Combining hybrid genetic search with ruin-and-recreate for solving the capacitated vehicle routing problem"* (2022) - Journal of Heuristics

**Academic Sources**:
- [VRP with Pickup and Delivery - ResearchGate](https://www.researchgate.net/profile/Jacques-Desrosiers/publication/200622146_VRP_with_Pickup_and_Delivery/links/0deec528e7769dcf1d000000/VRP-with-Pickup-and-Delivery.pdf)
- [Generalized vehicle routing problem: Contemporary trends](https://pmc.ncbi.nlm.nih.gov/articles/PMC10731084/)

#### **Pickup and Delivery Problem with Time Windows (PDPTW)**
Extends VRPPD with time window constraints ensuring customers are served within specified time ranges.

**Key Algorithms**:
- **Exact Methods**: Branch-and-cut, set-partitioning formulations, column generation
- **Metaheuristics**: Simulated annealing, ant colony optimization, adaptive large neighborhood search
- **Matheuristics**: Combination of mathematical programming with heuristics (AGES + LNS + Set Partitioning)

**Notable Research (2023-2024)**:
- Logic-Based Benders Decomposition (LBBD) improving optimality gaps
- Large Neighborhood Search (LNS) with adaptive configuration
- Token-based deep reinforcement learning for heterogeneous VRP (2024)

**Academic Sources**:
- [An Exact Algorithm for the Pickup and Delivery Problem with Time Windows - Operations Research](https://pubsonline.informs.org/doi/abs/10.1287/opre.1100.0881)
- [The pickup and delivery problem with time windows - ResearchGate](https://www.researchgate.net/publication/223369558_The_pickup_and_delivery_problem_with_time_windows)
- [A study on the pickup and delivery problem with time windows: Matheuristics and new instances](https://www.sciencedirect.com/science/article/abs/pii/S0305054820301829)

#### **Two-Echelon Vehicle Routing Problem (2E-VRP)**
Multi-stage routing with consolidation at intermediate hubs, particularly relevant for urban last-mile delivery with batch consolidation.

**Academic Sources**:
- [Two-echelon vehicle routing problems: A literature review](https://ideas.repec.org/a/eee/ejores/v304y2023i3p865-886.html)

### 1.2 Recent Research Trends (2023-2024)

**Key Developments**:
- Machine learning integration for learning optimization patterns automatically
- ~86% of current research uses approximate methods (metaheuristics > heuristics)
- ~40% uses hybrid methods combining multiple algorithms
- Growing focus on sustainability, green VRP variants, and electric vehicle routing

**Research Statistics**:
- Capacitated VRP remains the most dominant variant
- Over 60 research papers on 2E-VRP in recent years
- Modern metaheuristics reach within 0.5-1% of optimum for large instances

**Academic Sources**:
- [A Systematic Literature Review of Vehicle Routing Problems with Time Windows](https://ideas.repec.org/a/gam/jsusta/v15y2023i15p12004-d1210691.html)
- [Review of research on vehicle routing problems](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/13018/130180Y/Review-of-research-on-vehicle-routing-problems/10.1117/12.3024185.full)
- [Research Hotspot and Frontier Analysis of Vehicle Routing Optimization](https://dl.acm.org/doi/10.1145/3705374.3705376)

---

## 2. Real-World Implementations

### 2.1 DoorDash DeepRed System

**Architecture**: Multi-layered system with ML prediction layer + optimization decision layer

**Components**:
1. **ML Layer**: Predicts order ready times, travel times, driver acceptance rates
2. **Optimization Layer**: Scores/ranks offers, batching decisions, strategic dispatch delays

**Batching Algorithm**:
- **Mixed Integer Programming (MIP)** formulation solved with commercial solvers (Gurobi)
- **Objective**: Maximize Dasher efficiency while minimizing customer wait times
- **Batching Strategy**: Single Dasher picks up multiple orders from same/nearby stores
- **Delayed Dispatch**: Orders delayed by minutes to allow optimizer to explore route permutations

**Performance**:
- Commercial solvers (Gurobi) are **10x faster** than traditional matching algorithms
- Processes millions of orders daily
- Formulated as vehicle routing problem allowing multiple deliveries per route

**Key Innovation**: Combining ML predictions with MIP optimization rather than pure heuristics

**Sources**:
- [Using ML and Optimization to Solve DoorDash's Dispatch Problem](https://doordash.engineering/2021/08/17/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/)
- [Next-Generation Optimization for Dasher Dispatch at DoorDash](https://doordash.engineering/2020/02/28/next-generation-optimization-for-dasher-dispatch-at-doordash/)
- [How DoorDash Uses Machine Learning ML And Optimization Models](https://www.marktechpost.com/2021/08/23/how-doordash-uses-machine-learning-ml-and-optimization-models-to-solve-dispatch-problem/)

### 2.2 Other Industry Implementations

#### **Uber**
- Dispatch algorithms optimizing driver earnings + minimizing rider wait times
- ML models for driver acceptance rate prediction
- Similar batching approaches for Uber Eats

#### **General Logistics Platforms**
- **Hyperbatching**: Intelligent order grouping based on proximity, provider availability, optimized routes
- **Multi-Stop Routing TMS**: Transportation Management Systems consolidating shipments for same geographical area
- **Real-Time Optimization**: Dynamic route updates based on traffic conditions, demand prediction

**Sources**:
- [How to Optimize Your On-Demand Delivery like Uber, Doordash and Amazon](https://www.insightsforprofessionals.com/management/procurement/optimize-on-demand-delivery)
- [Hyperbatching: How Smart Routing and Multi-Dropoff Techniques Can Transform Delivery Logistics](https://www.nash.ai/blog/hyperbatching-how-smart-routing-and-multi-dropoff-techniques-can-transform-delivery-logistics)
- [A TMS Leverages Multi-Stop Routing to Optimize Every Load](https://ctsi-global.com/2024/a-tms-leverages-multi-stop-routing-to-optimize-every-load/)

---

## 3. Algorithm Names & Methodologies

### 3.1 Exact Algorithms

**Branch-and-Cut**
- Guarantees optimal solution
- Becomes impractical as customer count grows (exponential complexity)
- Suitable for small instances (<50 locations)

**Set Partitioning with Column Generation**
- Decomposition approach for large-scale problems
- Solves master problem + pricing subproblems iteratively
- Used in academic benchmarks

**Mixed Integer Programming (MIP)**
- Formulate routing as integer optimization problem
- Solved with commercial solvers (Gurobi, CPLEX)
- **DoorDash approach**: 10x faster than traditional algorithms

**Sources**:
- [An Exact Algorithm for the Pickup and Delivery Problem with Time Windows](https://pubsonline.informs.org/doi/abs/10.1287/opre.1100.0881)
- [Using ML and Optimization to Solve DoorDash's Dispatch Problem](https://doordash.engineering/2021/08/17/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/)

### 3.2 Metaheuristic Algorithms

#### **Hybrid Genetic Search (HGS)**
**Status**: Current state-of-the-art for CVRP and variants

**Characteristics**:
- Population-based evolutionary algorithm
- Local search education phase
- Diversity management mechanisms
- Outperforms main competing algorithms in solution quality and convergence speed
- Conceptually simple yet highly effective

**Performance**: Reaches within 0.5-1% of optimum for large instances

**Sources**:
- [Hybrid Genetic Search for the CVRP: Open-Source Implementation](https://www.sciencedirect.com/science/article/pii/S030505482100349X)
- [PyVRP: a high-performance VRP solver package](https://arxiv.org/abs/2403.13795)

#### **Adaptive Large Neighborhood Search (ALNS)**
**Mechanism**:
- Iteratively destroy and repair solutions
- Adaptive operator selection based on performance
- Ruin-and-recreate strategies

**Variants**:
- **Hybrid ALNS (HALNS)**: Combines ALNS with other metaheuristics
- **Parallel ALNS**: Distributed computation for large-scale problems

**Performance**: Outperforms pure ALNS when hybridized with genetic search

**Sources**:
- [Combining hybrid genetic search with ruin-and-recreate](https://link.springer.com/article/10.1007/s10732-022-09500-9)
- [Hybrid adaptive large neighborhood search for vehicle routing problems](https://www.sciencedirect.com/science/article/abs/pii/S0305054822001307)

#### **Tabu Search**
- Local search with memory structure preventing cycling
- Maintains tabu list of recently visited solutions
- Classic metaheuristic with proven effectiveness

#### **Simulated Annealing**
- Probabilistic technique allowing occasional uphill moves
- Temperature parameter controls exploration vs exploitation
- Avoids local optima through controlled randomization

**Sources**:
- [A Metaheuristic for the Pickup and Delivery Problem with Time Windows](https://www.researchgate.net/publication/3930722_A_Metaheuristic_for_the_Pickup_and_Delivery_Problem_with_Time_Windows)

### 3.3 Hybrid Approaches (Recommended)

**HGS + LNS Combination**
- Education phase of HGS extended with Large Neighborhood Search
- Combines population diversity (genetic) with intensification (LNS)
- Superior performance to pure implementations

**Matheuristics**
- Adaptive Guided Ejection Search (AGES) + LNS + Set Partitioning model
- Mathematical programming embedded within heuristic framework
- Best of both worlds: speed + quality

**Sources**:
- [Combining hybrid genetic search with ruin-and-recreate for solving the capacitated vehicle routing problem](https://ideas.repec.org/a/spr/joheur/v28y2022i5d10.1007_s10732-022-09500-9.html)

---

## 4. Key Differences from Traditional TSP

| Aspect | TSP | Batched Delivery VRP |
|--------|-----|----------------------|
| **Objective** | Minimize total distance visiting all nodes once | Minimize cost while satisfying capacity, time, precedence constraints |
| **Constraints** | Visit each node exactly once | Capacity limits, time windows, pickup-delivery pairing, precedence |
| **Vehicle Count** | Single salesman | Multiple vehicles with heterogeneous fleet possible |
| **Node Types** | Homogeneous (just visits) | Pickup nodes, delivery nodes, depots (heterogeneous) |
| **Load Tracking** | Not applicable | Must track vehicle load throughout route |
| **Temporal Aspects** | Optional | Time windows critical for real-world applications |
| **Problem Structure** | Simple cycle | Complex routes with multiple stops, pairing requirements |
| **Complexity** | NP-hard, O(n!) | NP-hard, exponentially more complex due to constraints |
| **Solution Methods** | Exact methods viable for ~100 nodes | Exact methods impractical beyond ~50 nodes, require metaheuristics |

**Additional Complexity Factors in VRP**:
1. **Precedence Constraints**: Pickup must occur before corresponding delivery
2. **Pairing Constraints**: Specific pickup-delivery relationships maintained
3. **Capacity Dynamics**: Vehicle load changes at each stop (increases at pickup, decreases at delivery)
4. **Time Window Feasibility**: Each stop must occur within specified time range
5. **Multi-Vehicle Coordination**: Fleet management and workload balancing
6. **Real-Time Dynamics**: Orders arriving continuously, requiring re-optimization

**Sources**:
- [Vehicle routing problem - Wikipedia](https://en.wikipedia.org/wiki/Vehicle_routing_problem)
- [The vehicle routing problem: Guide books](https://dl.acm.org/doi/10.5555/505847)

---

## 5. Open-Source Libraries & Frameworks

### 5.1 Python Libraries

#### **PyVRP** ⭐ Recommended
**Description**: Open-source, state-of-the-art VRP solver with high performance

**Features**:
- Implements Hybrid Genetic Search (HGS) metaheuristic
- Pre-compiled binaries for Windows, Mac OS, Linux (easy installation)
- **Pickup & Delivery Support**: ✅ Full support for VRPPD variants
- Capacitated VRP with simultaneous pickup and delivery
- VRP with backhaul
- Heterogeneous fleet with different capacities, costs, shift durations
- Time windows, service durations, release times
- Multiple depots, maximum distance/duration constraints

**Performance**: Leading metaheuristic in solution quality and convergence speed

**Installation**: `pip install pyvrp`

**Links**:
- [PyVRP Documentation](https://pyvrp.org/)
- [PyVRP GitHub](https://github.com/PyVRP/PyVRP)
- [PyVRP Research Paper](https://arxiv.org/abs/2403.13795)

#### **VRPy**
**Description**: Python package using column generation approach

**Features**:
- State-of-the-art column generation methods
- Range of VRP variants supported
- More academic/research-oriented

**Links**:
- [VRPy GitHub](https://github.com/Kuifje02/vrpy)
- [VRPy Research Paper](https://www.researchgate.net/publication/345728852_VRPy_A_Python_package_for_solving_a_range_of_vehicle_routing_problems_with_a_column_generation_approach)

#### **pyVRP** (Alternative)
**Description**: Genetic algorithm-based solver

**Features**:
- Capacitated VRP, Multiple Depot VRP
- VRP with Time Windows
- Heterogeneous/Homogeneous Fleet
- Finite/Infinite Fleet, Open/Closed Routes
- TSP, mTSP variants

**Links**:
- [pyVRP GitHub](https://github.com/Valdecy/pyVRP)

### 5.2 Java Libraries

#### **Jsprit** ⭐ Industry-Proven
**Description**: Java-based toolkit for rich vehicle routing problems (maintained by GraphHopper)

**Features**:
- Lightweight, flexible, easy-to-use
- Single all-purpose metaheuristic
- **Pickup & Delivery Support**: ✅ Extensive support
- Multiple depots, heterogeneous fleet
- Skills/constraints modeling
- Time windows, capacity constraints
- Used by GraphHopper's commercial Route Optimization API

**Integration**: World's first complete open source vehicle routing system (ODL Studio + Jsprit)

**Links**:
- [Jsprit GitHub](https://github.com/graphhopper/jsprit)
- [Jsprit Documentation](https://jsprit.github.io/references.html)
- [GraphHopper Open Source](https://www.graphhopper.com/open-source/)

### 5.3 C++ Routing Engines

#### **VROOM** ⭐ High-Performance
**Description**: Vehicle Routing Open-source Optimization Machine

**Features**:
- Written in C++20, solves VRP in **milliseconds**
- **Pickup & Delivery Support**: ✅ Native support for shipments
- Single-location pickup/delivery tasks (jobs)
- Pickup-and-delivery tasks within same route (shipments)
- Integrates with OSRM, Openrouteservice, Valhalla as routing backends
- Custom cost matrix support
- Real-life VRP optimization focus

**Performance**: Extremely fast for production use

**Links**:
- [VROOM GitHub](https://github.com/VROOM-Project/vroom)
- [VROOM Project Website](http://vroom-project.org/)

#### **OSRM vs GraphHopper** (Routing Engines, not VRP solvers)
**Note**: These are routing engines (distance/time calculation), not VRP solvers. VROOM uses these as backends.

**OSRM**:
- Fast routing across Europe in milliseconds
- Requires 64GB RAM for world queries (resource-intensive)
- Completed 10,000 legs in 28.682 seconds

**GraphHopper**:
- Faster than OSRM in benchmarks (23.586s for 10,000 legs)
- Scales from big servers to mobile devices
- More flexible deployment

**Links**:
- [Technote: Graphhopper vs OSRM vs Gosmore](https://www.routexl.com/blog/openstreetmap-router-graphhopper-osrm-gosmore/)
- [GEOFABRIK Routing with OSRM and GraphHopper](https://www.geofabrik.de/data/routing.html)

### 5.4 Commercial Solvers (for MIP formulations)

#### **Gurobi**
- Industry-standard MIP solver
- Used by DoorDash (10x faster than traditional algorithms)
- Commercial license required (free academic licenses available)

#### **CPLEX**
- IBM's optimization solver
- Similar capabilities to Gurobi
- Commercial license required

**Sources**:
- [Using ML and Optimization to Solve DoorDash's Dispatch Problem](https://doordash.engineering/2021/08/17/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/)

### 5.5 Comparison Matrix

| Library | Language | Algorithm | P&D Support | Performance | Ease of Use | License |
|---------|----------|-----------|-------------|-------------|-------------|---------|
| **PyVRP** | Python | HGS | ✅ Full | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | MIT |
| **VRPy** | Python | Column Gen | ✅ Full | ⭐⭐⭐⭐ | ⭐⭐⭐ | MIT |
| **Jsprit** | Java | Metaheuristic | ✅ Full | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | Apache 2.0 |
| **VROOM** | C++ | Heuristic | ✅ Full | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | BSD |
| **Gurobi** | Multi | MIP | Via formulation | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | Commercial |

---

## 6. Recommended Approaches for EdgeRun

### 6.1 Architecture Recommendation

**Two-Layer System** (Following DoorDash's proven approach):

```
┌─────────────────────────────────────────────────────────┐
│                    ML Prediction Layer                   │
│  - Order ready time prediction                          │
│  - Travel time estimation                               │
│  - Driver acceptance probability                        │
│  - Demand forecasting                                   │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                 Optimization Decision Layer              │
│  - Batching algorithm (HGS or MIP)                      │
│  - Route generation                                     │
│  - Driver assignment                                    │
│  - Delayed dispatch optimization                       │
└─────────────────────────────────────────────────────────┘
```

### 6.2 Implementation Strategy by Scale

#### **Phase 1: MVP (< 100 deliveries/hour)**
**Recommended**: PyVRP with default HGS algorithm

**Rationale**:
- Fastest time-to-market
- Python integration (likely matches EdgeRun stack)
- Pre-built binaries, no compilation needed
- State-of-the-art performance out-of-the-box
- Full pickup & delivery support

**Implementation**:
```python
from pyvrp import Model, solve

# Define vehicles, locations, time windows, pickup-delivery pairs
model = Model()
# ... configure model ...
solution = solve(model)
```

**Complexity**: Low (1-2 weeks for basic integration)

#### **Phase 2: Growth (100-1000 deliveries/hour)**
**Recommended**: PyVRP + ML predictions + strategic batching delays

**Enhancements**:
- Add ML layer for time predictions (LightGBM, XGBoost)
- Implement delayed dispatch (2-5 minute windows)
- Real-time re-optimization every 30-60 seconds
- A/B testing framework for algorithm parameters

**Complexity**: Medium (1-2 months with ML integration)

#### **Phase 3: Scale (1000+ deliveries/hour)**
**Recommended**: Migrate to VROOM or Custom MIP with Gurobi

**Rationale**:
- VROOM's C++ performance for sub-second optimization
- Gurobi's commercial solver for complex constraints
- Microservices architecture for distributed optimization
- Real-time traffic integration via routing engine APIs

**Architecture**:
```
Load Balancer → Optimization Microservices (VROOM/Gurobi)
                      ↓
             Redis Cache (solutions)
                      ↓
             Routing Engine (OSRM/GraphHopper)
```

**Complexity**: High (3-6 months for production-grade system)

### 6.3 Algorithm Selection Guide

| Scenario | Algorithm | Tool | Rationale |
|----------|-----------|------|-----------|
| MVP, quick validation | HGS | PyVRP | Best quality/effort ratio |
| Need explainability | MIP | Gurobi + Python | Transparent objective function |
| Ultra-high volume | Custom Heuristic | VROOM (C++) | Millisecond-level performance |
| Research/experimentation | Column Generation | VRPy | Academic flexibility |
| Multi-language stack | Metaheuristic | Jsprit (Java) | JVM ecosystem integration |

### 6.4 Key Success Factors

1. **Start Simple**: Don't over-engineer initially. PyVRP + basic constraints → iterate
2. **Measure Everything**: Track actual vs predicted times, acceptance rates, customer satisfaction
3. **Delayed Dispatch**: Allow 2-5 minute dispatch delays for better batching (proven by DoorDash)
4. **ML Integration**: Predict order ready times accurately (biggest source of inefficiency)
5. **Real-Time Adaptation**: Re-optimize routes when new orders arrive or drivers become available
6. **A/B Testing**: Test algorithm parameters against business metrics (delivery time, driver efficiency)

### 6.5 Common Pitfalls to Avoid

❌ **Optimizing for distance alone**: Consider time windows, customer satisfaction, driver experience
❌ **Ignoring uncertainty**: Build buffer times, use probabilistic approaches
❌ **Static optimization**: Real-world requires continuous re-optimization
❌ **Over-batching**: Too many stops frustrates drivers and delays deliveries
❌ **Underestimating complexity**: VRP is NP-hard; don't try to write solver from scratch
❌ **Neglecting edge cases**: Driver no-shows, order cancellations, traffic accidents

---

## 7. Implementation Complexity Assessment

### 7.1 Complexity Dimensions

| Dimension | Low | Medium | High |
|-----------|-----|--------|------|
| **Algorithm Selection** | Use library (PyVRP) | Tune parameters | Custom solver |
| **Integration** | Batch offline | Semi-real-time | Real-time streaming |
| **Constraints** | Basic capacity | + Time windows | + Custom constraints |
| **Scale** | <100 orders/hour | 100-1000 | 1000+ |
| **ML Integration** | None | Simple predictions | Complex multi-model |
| **Infrastructure** | Single server | Load-balanced | Distributed microservices |

### 7.2 Timeline Estimates

**Basic Implementation** (PyVRP + simple constraints):
- Development: 1-2 weeks
- Testing: 1 week
- Deployment: 1 week
- **Total**: 3-4 weeks

**Production System** (ML + real-time optimization):
- Architecture design: 2 weeks
- ML model development: 4-6 weeks
- Optimization integration: 4 weeks
- Infrastructure setup: 2 weeks
- Testing & iteration: 4 weeks
- **Total**: 16-20 weeks (4-5 months)

**Enterprise Scale** (Custom solvers + microservices):
- Requirements gathering: 2 weeks
- System design: 4 weeks
- Core development: 12-16 weeks
- ML pipeline: 8 weeks
- Integration testing: 6 weeks
- Performance optimization: 4 weeks
- **Total**: 36-44 weeks (9-11 months)

### 7.3 Technical Challenges

**Algorithmic Complexity**:
- VRP is NP-hard; exact solutions intractable for n > 50
- Metaheuristics provide no optimality guarantees
- Parameter tuning requires domain expertise

**Engineering Challenges**:
- Real-time constraint: Must optimize in seconds, not minutes
- Uncertainty: Predictions always imperfect (ready times, traffic)
- Dynamic environment: New orders arriving, drivers becoming available
- Scalability: Performance degrades non-linearly with problem size

**Operational Challenges**:
- Driver acceptance: Algorithmic optimal ≠ driver-preferred
- Customer expectations: Fast delivery vs batching efficiency trade-off
- Edge cases: Handling exceptions gracefully (cancellations, no-shows)

### 7.4 Resource Requirements

**Minimum (MVP)**:
- 1 backend engineer
- 1 data scientist (optional, for ML)
- Compute: Single server (4 cores, 8GB RAM)

**Production**:
- 2-3 backend engineers
- 1-2 data scientists
- 1 DevOps engineer
- Compute: Load-balanced cluster (8+ cores, 16GB+ RAM per instance)

**Enterprise**:
- 5-8 engineers (backend, algorithms, ML)
- 2-3 data scientists
- 2 DevOps/SRE engineers
- 1 operations analyst
- Compute: Kubernetes cluster, Redis, message queues, monitoring

---

## 8. Additional Resources

### 8.1 Academic Resources

**Key Books**:
- *Vehicle Routing: Problems, Methods, and Applications* - Toth & Vigo (comprehensive reference)
- *The Vehicle Routing Problem* - SIAM (mathematical foundations)

**Benchmark Datasets**:
- Solomon VRPTW benchmarks (standard academic testbed)
- Gehring & Homberger instances (large-scale VRPTW)
- VRPLIB - comprehensive VRP instance library

**Links**:
- [VRPLIB on GitHub](https://github.com/PyVRP/VRPLIB)

### 8.2 Industry Resources

**Blogs & Case Studies**:
- [DoorDash Engineering Blog](https://doordash.engineering/)
- [Uber Engineering Blog](https://www.uber.com/blog/engineering/)
- [NextBillion.ai Blog](https://nextbillion.ai/blog/) - Logistics optimization articles

**Tools & Platforms**:
- [Routific](https://www.routific.com/) - Commercial route optimization
- [Mapbox](https://www.mapbox.com/on-demand-logistics) - Logistics API platform
- [Open Door Logistics](https://opendoorlogistics.com/) - Open source VRP system

**Links**:
- [Logistics Route Optimization Guide](https://nextbillion.ai/blog/logistics-route-optimization)
- [Advanced Routing and Optimization Algorithms](https://www.linkedin.com/pulse/advanced-routing-optimization-algorithms-efficient-logistics-azhar-zhdnf)

### 8.3 Algorithm Visualization

**Understanding VRP Algorithms**:
- [What is the Vehicle Routing Problem - Routific](https://www.routific.com/blog/what-is-the-vehicle-routing-problem)
- [Pickup and Delivery Problem with Time Windows Explained](https://www.upperinc.com/glossary/route-optimization/pickup-and-delivery-problem-with-time-windows-pdptw/)

---

## 9. Conclusion

### 9.1 Key Takeaways

1. **Batched delivery routing is a well-studied problem** (VRPPD/PDPTW) with mature academic foundations and proven industry implementations

2. **Modern algorithms achieve near-optimal solutions**: Hybrid Genetic Search (HGS) + Large Neighborhood Search (LNS) reach within 0.5-1% of optimum for large instances

3. **Production systems use hybrid approaches**: DoorDash's success with ML predictions + MIP optimization demonstrates the value of combining techniques

4. **Open-source tools are production-ready**: PyVRP, VROOM, and Jsprit provide state-of-the-art performance without building from scratch

5. **Implementation complexity scales with requirements**: MVP possible in 3-4 weeks; production system requires 4-5 months; enterprise scale 9-11 months

### 9.2 Recommended Next Steps for EdgeRun

**Immediate (Week 1-2)**:
1. Install PyVRP: `pip install pyvrp`
2. Model current EdgeRun constraints (capacity, time windows, pickup-delivery pairs)
3. Run benchmark on historical order data
4. Compare against current routing approach

**Short-term (Month 1-3)**:
1. Implement PyVRP integration in staging environment
2. A/B test against current system (50/50 traffic split)
3. Measure: delivery time, driver efficiency, customer satisfaction
4. Begin ML model development for time predictions

**Medium-term (Month 4-6)**:
1. Add ML prediction layer (order ready times, travel times)
2. Implement delayed dispatch optimization (2-5 minute windows)
3. Real-time re-optimization on order arrival/driver availability
4. Monitor performance metrics and iterate

**Long-term (Month 7+)**:
1. Evaluate migration to VROOM (if scale demands microsecond optimization)
2. Consider commercial MIP solver (Gurobi) for complex constraints
3. Build microservices architecture for distributed optimization
4. Advanced features: dynamic pricing, proactive repositioning, demand forecasting

### 9.3 Success Metrics

Track these metrics to validate algorithm effectiveness:

**Efficiency Metrics**:
- Orders per driver per hour
- Average route distance/duration
- Vehicle utilization rate
- Batching rate (% of orders batched)

**Quality Metrics**:
- Average delivery time (order placed → delivered)
- On-time delivery rate (within promised window)
- Customer satisfaction scores
- Driver satisfaction scores

**Operational Metrics**:
- Optimization runtime (must be < 5 seconds for real-time)
- Driver acceptance rate
- Order cancellation rate
- System uptime/reliability

### 9.4 Risk Mitigation

**Technical Risks**:
- Algorithm doesn't converge fast enough → Use VROOM (C++) or commercial solver
- Solution quality insufficient → Add domain-specific constraints, tune parameters
- Scalability issues → Implement microservices, caching, distributed optimization

**Business Risks**:
- Drivers reject optimized routes → Incorporate driver preferences, limit max stops
- Customers unhappy with delays → Tighten time windows, reduce batching aggressiveness
- System downtime → Implement fallback to simple heuristics, redundancy

---

## Sources

### Academic Papers & Books
- [Vehicle routing problem - Wikipedia](https://en.wikipedia.org/wiki/Vehicle_routing_problem)
- [The vehicle routing problem: Guide books - ACM Digital Library](https://dl.acm.org/doi/10.5555/505847)
- [VRP with Pickup and Delivery - ResearchGate](https://www.researchgate.net/profile/Jacques-Desrosiers/publication/200622146_VRP_with_Pickup_and_Delivery/links/0deec528e7769dcf1d000000/VRP-with-Pickup-and-Delivery.pdf)
- [Generalized vehicle routing problem: Contemporary trends - PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC10731084/)
- [An Exact Algorithm for the Pickup and Delivery Problem with Time Windows - Operations Research](https://pubsonline.informs.org/doi/abs/10.1287/opre.1100.0881)
- [The pickup and delivery problem with time windows - ResearchGate](https://www.researchgate.net/publication/223369558_The_pickup_and_delivery_problem_with_time_windows)
- [A study on the pickup and delivery problem with time windows: Matheuristics - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0305054820301829)
- [Two-echelon vehicle routing problems: A literature review](https://ideas.repec.org/a/eee/ejores/v304y2023i3p865-886.html)
- [A Systematic Literature Review of Vehicle Routing Problems with Time Windows](https://ideas.repec.org/a/gam/jsusta/v15y2023i15p12004-d1210691.html)
- [Review of research on vehicle routing problems - SPIE](https://www.spiedigitallibrary.org/conference-proceedings-of-spie/13018/130180Y/Review-of-research-on-vehicle-routing-problems/10.1117/12.3024185.full)
- [Research Hotspot and Frontier Analysis of Vehicle Routing Optimization - ACM](https://dl.acm.org/doi/10.1145/3705374.3705376)
- [Hybrid Genetic Search for the CVRP: Open-Source Implementation - ScienceDirect](https://www.sciencedirect.com/science/article/pii/S030505482100349X)
- [PyVRP: a high-performance VRP solver package - arXiv](https://arxiv.org/abs/2403.13795)
- [Combining hybrid genetic search with ruin-and-recreate - Journal of Heuristics](https://link.springer.com/article/10.1007/s10732-022-09500-9)
- [Hybrid adaptive large neighborhood search for vehicle routing problems - ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S0305054822001307)
- [Complexity of vehicle routing and scheduling problems - ResearchGate](https://www.researchgate.net/publication/229563032_Complexity_of_vehicle_routing_and_scheduling_problems)

### Industry Implementations
- [Using ML and Optimization to Solve DoorDash's Dispatch Problem](https://doordash.engineering/2021/08/17/using-ml-and-optimization-to-solve-doordashs-dispatch-problem/)
- [Next-Generation Optimization for Dasher Dispatch at DoorDash](https://doordash.engineering/2020/02/28/next-generation-optimization-for-dasher-dispatch-at-doordash/)
- [How DoorDash Uses Machine Learning ML And Optimization Models - MarkTechPost](https://www.marktechpost.com/2021/08/23/how-doordash-uses-machine-learning-ml-and-optimization-models-to-solve-dispatch-problem/)
- [How to Optimize Your On-Demand Delivery like Uber, Doordash and Amazon](https://www.insightsforprofessionals.com/management/procurement/optimize-on-demand-delivery)
- [Hyperbatching: How Smart Routing and Multi-Dropoff Techniques Can Transform Delivery Logistics - Nash](https://www.nash.ai/blog/hyperbatching-how-smart-routing-and-multi-dropoff-techniques-can-transform-delivery-logistics)
- [A TMS Leverages Multi-Stop Routing to Optimize Every Load - CTSI](https://ctsi-global.com/2024/a-tms-leverages-multi-stop-routing-to-optimize-every-load/)
- [Logistics Route Optimization: Guide in 2025 - NextBillion.ai](https://nextbillion.ai/blog/logistics-route-optimization)
- [Advanced Routing and Optimization Algorithms for Efficient Logistics - LinkedIn](https://www.linkedin.com/pulse/advanced-routing-optimization-algorithms-efficient-logistics-azhar-zhdnf)

### Open-Source Libraries
- [PyVRP Documentation](https://pyvrp.org/)
- [PyVRP GitHub](https://github.com/PyVRP/PyVRP)
- [VRPy GitHub](https://github.com/Kuifje02/vrpy)
- [VRPy Research Paper - ResearchGate](https://www.researchgate.net/publication/345728852_VRPy_A_Python_package_for_solving_a_range_of_vehicle_routing_problems_with_a_column_generation_approach)
- [pyVRP GitHub](https://github.com/Valdecy/pyVRP)
- [Jsprit GitHub](https://github.com/graphhopper/jsprit)
- [Jsprit Documentation](https://jsprit.github.io/references.html)
- [GraphHopper Open Source](https://www.graphhopper.com/open-source/)
- [VROOM GitHub](https://github.com/VROOM-Project/vroom)
- [VROOM Project Website](http://vroom-project.org/)
- [VRPLIB on GitHub](https://github.com/PyVRP/VRPLIB)

### Routing Engines & Tools
- [Technote: Graphhopper vs OSRM vs Gosmore - RouteXL](https://www.routexl.com/blog/openstreetmap-router-graphhopper-osrm-gosmore/)
- [GEOFABRIK Routing with OSRM and GraphHopper](https://www.geofabrik.de/data/routing.html)
- [What is the Vehicle Routing Problem - Routific](https://www.routific.com/blog/what-is-the-vehicle-routing-problem)
- [Pickup and Delivery Problem with Time Windows Explained - Upper](https://www.upperinc.com/glossary/route-optimization/pickup-and-delivery-problem-with-time-windows-pdptw/)

---

**Report End**

*For questions or clarifications on this research, please refer to the sources provided or contact the research team.*
