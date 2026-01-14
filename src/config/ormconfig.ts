import "reflect-metadata";
import { DataSource } from "typeorm";
import { DefaultNamingStrategy, NamingStrategyInterface } from "typeorm";
import { snakeCase } from "typeorm/util/StringUtils";
import { Driver } from "../entities/Driver";
import { DriverLocation } from "../entities/DriverLocation";
import { Customer } from "../entities/Customer";
import { Order } from "../entities/Order";
import { OrderAssignment } from "../entities/OrderAssignment";
import { TimeWindow } from "../entities/TimeWindow";
import { RouteSegmentObservation } from "../entities/RouteSegmentObservation";
import { DraftGroup } from "../entities/DraftGroup";
import { DraftAssignment } from "../entities/DraftAssignment";
import { DistanceCache } from "../entities/DistanceCache";
import * as dotenv from "dotenv";

dotenv.config();

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

export const AppDataSource = new DataSource({
  type: "postgres",
  host: DB_HOST || "localhost",
  port: parseInt(DB_PORT || "5432"),
  username: DB_USER || "postgres",
  password: DB_PASSWORD || "",
  database: DB_NAME || "edgerun_db",
  synchronize: false,
  logging: process.env.NODE_ENV === "development",
  entities: [
    Driver,
    DriverLocation,
    Customer,
    Order,
    OrderAssignment,
    TimeWindow,
    RouteSegmentObservation,
    DraftGroup,
    DraftAssignment,
    DistanceCache,
  ],
  migrations: [__dirname + "/../migrations/*.ts"],
  subscribers: [],
});
