// NOTE: TSOA is now handling Swagger generation automatically
// This file is kept for backward compatibility with the legacy User routes

// import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'EdgeRun API',
      version: '1.0.0',
      description: 'A production-ready Express.js + TypeScript + TypeORM backend API',
      contact: {
        name: 'EdgeRun Support',
        url: 'https://github.com/yourusername/edgerun',
      },
      license: {
        name: 'ISC',
      },
    },
    servers: [
      {
        url: `http://localhost:${process.env.PORT || 3000}`,
        description: 'Development Server',
      },
      {
        url: 'https://api.edgerun.com',
        description: 'Production Server',
      },
    ],
    components: {
      schemas: {
        User: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            id: {
              type: 'string',
              format: 'uuid',
              description: 'User ID',
            },
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            name: {
              type: 'string',
              description: 'User full name',
            },
            password: {
              type: 'string',
              description: 'User password (hashed in database)',
            },
            isActive: {
              type: 'boolean',
              default: false,
              description: 'Account activation status',
            },
            createdAt: {
              type: 'string',
              format: 'date-time',
              description: 'Account creation timestamp',
            },
            updatedAt: {
              type: 'string',
              format: 'date-time',
              description: 'Last update timestamp',
            },
          },
          example: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'john@example.com',
            name: 'John Doe',
            password: 'hashed_password',
            isActive: true,
            createdAt: '2025-10-27T19:20:00Z',
            updatedAt: '2025-10-27T19:20:00Z',
          },
        },
        CreateUserRequest: {
          type: 'object',
          required: ['email', 'name', 'password'],
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            name: {
              type: 'string',
              description: 'User full name',
            },
            password: {
              type: 'string',
              description: 'User password',
            },
          },
          example: {
            email: 'john@example.com',
            name: 'John Doe',
            password: 'securepassword123',
          },
        },
        UpdateUserRequest: {
          type: 'object',
          properties: {
            email: {
              type: 'string',
              format: 'email',
              description: 'User email address',
            },
            name: {
              type: 'string',
              description: 'User full name',
            },
            password: {
              type: 'string',
              description: 'User password',
            },
            isActive: {
              type: 'boolean',
              description: 'Account activation status',
            },
          },
          example: {
            name: 'Jane Doe',
            isActive: true,
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: {
              type: 'object',
              properties: {
                status: {
                  type: 'number',
                  description: 'HTTP status code',
                },
                message: {
                  type: 'string',
                  description: 'Error message',
                },
              },
            },
          },
          example: {
            error: {
              status: 400,
              message: 'User with this email already exists',
            },
          },
        },
        HealthResponse: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              description: 'Health status',
            },
            timestamp: {
              type: 'string',
              format: 'date-time',
              description: 'Response timestamp',
            },
          },
          example: {
            status: 'OK',
            timestamp: '2025-10-27T19:20:00Z',
          },
        },
      },
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token (to be implemented)',
        },
      },
    },
    tags: [
      {
        name: 'Health',
        description: 'Health check endpoints',
      },
      {
        name: 'Users',
        description: 'User management endpoints',
      },
    ],
  },
  apis: ['./src/routes/*.ts'],
};

// export const swaggerSpec = swaggerJsdoc(options);

// Placeholder for swagger spec (TSOA generates this automatically)
export const swaggerSpec = {};
