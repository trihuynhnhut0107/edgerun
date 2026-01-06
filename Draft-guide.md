Draft guide

- In the draft mode, we will group every order and driver in to regions, and perform necessary action of each draft in each regional group, to avoid crossover.
- In the draft mode, we go brute force, by check each driver to each orders in that region, use mapbox api to check travel time and record that in each draft record.
- Each draft record should be in a group of draft, for after draft picking.
- A draft group should cover all orders picked up and delivered by all or less drivers in that region, with proper order.
- After draft, output is a single group of draft that provide the best result (fastest total delivery time).
