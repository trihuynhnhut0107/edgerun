# EdgeRun Backend

A production-ready Express.js + TypeScript + TypeORM + PostgreSQL backend server.

## 🚀 Quick Start

### Prerequisites
- Node.js 20+ and npm
- Docker and Docker Compose
- PostgreSQL (or use Docker)

### Using Docker for PostgreSQL

```bash
# Start PostgreSQL container only
npm run db:up

# View database logs
npm run db:logs

# Stop database container
npm run db:down
```

Then start the API server:
```bash
npm run dev
```

The API will be available at `http://localhost:3000`
The API documentation will be available at `http://localhost:3000/api-docs`

### Manual Setup (Local PostgreSQL)

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your PostgreSQL credentials
   ```

3. **Start the development server**
   ```bash
   npm run dev
   ```

4. **Seed the database (optional)**
   ```bash
   npm run seed
   ```

## 📁 Project Structure

```
src/
├── config/           # Configuration files (database, etc.)
├── entities/         # TypeORM entities
├── repositories/     # Database access layer
├── services/         # Business logic layer
├── routes/           # API routes
├── middleware/       # Express middleware
├── utils/            # Utility functions
├── migrations/       # Database migrations (when created)
└── index.ts          # Application entry point
```

## 🔧 Available Scripts

- `npm run dev` - Start development server with hot-reload
- `npm run build` - Build TypeScript to JavaScript
- `npm run start` - Start production server
- `npm run seed` - Seed database with sample data
- `npm run migration:generate` - Generate migrations from entities
- `npm run migration:run` - Run migrations
- `npm run migration:revert` - Revert migrations
- `npm run db:up` - Start PostgreSQL Docker container
- `npm run db:down` - Stop PostgreSQL Docker container
- `npm run db:logs` - View PostgreSQL container logs

## 🗄️ Database

### PostgreSQL with Docker

The docker-compose file includes PostgreSQL 16 Alpine with:
- Automatic initialization
- Health checks
- Volume persistence
- Network isolation

**Default Credentials:**
- Host: `localhost`
- Port: `5432`
- Username: `edgerun_user`
- Password: `edgerun_password`
- Database: `edgerun_db`

### Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_USER=edgerun_user
DB_PASSWORD=edgerun_password
DB_NAME=edgerun_db

# Server Configuration
NODE_ENV=development
PORT=3000

# TypeORM Configuration
TYPEORM_SYNCHRONIZE=false
TYPEORM_LOGGING=true
```

## 📚 API Documentation

### Swagger/OpenAPI Documentation

Once the server is running, visit the interactive API documentation at:
```
http://localhost:3000/api-docs
```

Features:
- ✅ Interactive endpoint testing
- ✅ Request/response schemas
- ✅ Parameter descriptions
- ✅ Example requests and responses

See [SWAGGER.md](./SWAGGER.md) for detailed documentation.

### API Endpoints

- `GET /health` - Health check
- `GET /api/users` - Get all users
- `GET /api/users/:id` - Get user by ID
- `POST /api/users` - Create new user
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

### Create User Example

```bash
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "email": "user@example.com",
    "name": "John Doe",
    "password": "secure_password"
  }'
```

## 🏗️ Architecture

### Layers

1. **Route Layer** (`routes/`) - Express routes and HTTP handlers
2. **Service Layer** (`services/`) - Business logic and validation
3. **Repository Layer** (`repositories/`) - Database access
4. **Entity Layer** (`entities/`) - Data models with TypeORM decorators

### Benefits

- **Separation of Concerns** - Each layer has a specific responsibility
- **Testability** - Services and repositories can be mocked
- **Maintainability** - Clear code organization
- **Scalability** - Easy to add new features

## 🔄 Example: Adding a New Entity

1. **Create Entity** (`src/entities/Product.ts`)
   ```typescript
   import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

   @Entity('products')
   export class Product {
     @PrimaryGeneratedColumn('uuid')
     id: string;

     @Column({ type: 'varchar', length: 255 })
     name: string;
   }
   ```

2. **Create Repository** (`src/repositories/ProductRepository.ts`)
   ```typescript
   export class ProductRepository {
     // Similar to UserRepository...
   }
   ```

3. **Create Service** (`src/services/ProductService.ts`)
   ```typescript
   export class ProductService {
     // Similar to UserService...
   }
   ```

4. **Create Routes** (`src/routes/productRoutes.ts`)
   ```typescript
   // Similar to userRoutes...
   ```

5. **Register Routes** in `src/index.ts`
   ```typescript
   app.use('/api/products', productRoutes);
   ```

6. **Update Database Config**
   ```typescript
   // In src/config/database.ts, add to entities array
   entities: [User, Product],
   ```

## 🚨 Error Handling

The application includes a global error handler middleware that catches all errors and returns consistent error responses:

```json
{
  "error": {
    "status": 400,
    "message": "Error description"
  }
}
```

## 🔒 Security

The application includes security middleware:
- **Helmet** - Sets HTTP headers for security
- **CORS** - Controls cross-origin requests
- **Input Validation** - Basic validation in routes

For production, consider adding:
- Rate limiting
- JWT authentication
- Request validation (joi, yup)
- Data encryption

## 📖 TypeORM Resources

- [TypeORM Documentation](https://typeorm.io/)
- [PostgreSQL Driver](https://typeorm.io/data-source-options#postgres-driver)
- [Query Builder](https://typeorm.io/select-query-builder)
- [Migrations](https://typeorm.io/migrations)

## 🐳 Docker

### Build Custom Image

```bash
docker build -t edgerun:latest .
```

### Run Individual Container

```bash
docker run -d \
  -e DB_HOST=postgres \
  -e DB_PORT=5432 \
  -e DB_USER=edgerun_user \
  -e DB_PASSWORD=edgerun_password \
  -e DB_NAME=edgerun_db \
  -p 3000:3000 \
  edgerun:latest
```

## 📝 Next Steps

1. **Add Authentication** - Implement JWT tokens
2. **Add Validation** - Use libraries like `joi` or `class-validator`
3. **Add Testing** - Setup Jest and write unit/integration tests
4. **Add Logging** - Implement structured logging with Winston or Pino
5. **Add API Documentation** - Use Swagger/OpenAPI

## 📄 License

ISC
