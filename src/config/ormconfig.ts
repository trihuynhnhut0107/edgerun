import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Driver } from '../entities/Driver';
import { DriverLocation } from '../entities/DriverLocation';
import { Order } from '../entities/Order';
import { OrderAssignment } from '../entities/OrderAssignment';
import { TimeWindow } from '../entities/TimeWindow';
import { RouteSegmentObservation } from '../entities/RouteSegmentObservation';
import * as dotenv from 'dotenv';

dotenv.config();

const { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } = process.env;

export const AppDataSource = new DataSource({
    type: 'postgres',
    host: DB_HOST || 'localhost',
    port: parseInt(DB_PORT || '5432'),
    username: DB_USER || 'postgres',
    password: DB_PASSWORD || '',
    database: DB_NAME || 'edgerun_db',
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
    entities: [Driver, DriverLocation, Order, OrderAssignment, TimeWindow, RouteSegmentObservation],
    migrations: [__dirname + '/../migrations/*.ts'],
    subscribers: []
});
