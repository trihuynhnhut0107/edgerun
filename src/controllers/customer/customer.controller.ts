import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Route,
  Body,
  Path,
  Response,
  Tags,
} from 'tsoa';
import { customerService } from '../../services/customer/customer.service';
import { CreateCustomerRequest } from '../../dtos/customer/create-customer.request';
import { UpdateCustomerRequest } from '../../dtos/customer/update-customer.request';
import { CustomerResponse } from '../../dtos/customer/customer.response';

@Route('customers')
@Tags('Customers')
export class CustomerController extends Controller {
  /**
   * Register a new customer
   *
   * @param body Customer registration data
   * @returns Created customer information
   */
  @Post()
  @Response<CustomerResponse>(201, 'Customer created')
  @Response<{ error: string }>(400, 'Validation error')
  @Response<{ error: string }>(409, 'Email or phone already registered')
  async registerCustomer(
    @Body() body: CreateCustomerRequest
  ): Promise<CustomerResponse> {
    try {
      const customer = await customerService.createCustomer({
        name: body.name,
        email: body.email,
        phone: body.phone,
        defaultAddress: body.defaultAddress,
        defaultLocation: body.defaultLocation,
      });

      this.setStatus(201);

      const locationCoords = customer.defaultLocation?.coordinates;

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        defaultAddress: customer.defaultAddress,
        defaultLocation: locationCoords
          ? {
              lat: locationCoords[1],
              lng: locationCoords[0],
            }
          : undefined,
        createdAt: customer.createdAt,
      };
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('already registered')
      ) {
        this.setStatus(409);
      } else {
        this.setStatus(400);
      }
      throw error;
    }
  }

  /**
   * Get customer by ID
   *
   * @param id Customer ID
   * @returns Customer information
   */
  @Get('{id}')
  @Response<CustomerResponse>(200, 'Customer found')
  @Response<{ error: string }>(404, 'Customer not found')
  async getCustomer(@Path() id: string): Promise<CustomerResponse> {
    const customer = await customerService.getCustomer(id);

    if (!customer) {
      this.setStatus(404);
      throw new Error('Customer not found');
    }

    const locationCoords = customer.defaultLocation?.coordinates;

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      defaultAddress: customer.defaultAddress,
      defaultLocation: locationCoords
        ? {
            lat: locationCoords[1],
            lng: locationCoords[0],
          }
        : undefined,
      createdAt: customer.createdAt,
    };
  }

  /**
   * Get customer by email
   *
   * @param email Customer email address
   * @returns Customer information
   */
  @Get('email/{email}')
  @Response<CustomerResponse>(200, 'Customer found')
  @Response<{ error: string }>(404, 'Customer not found')
  async getCustomerByEmail(@Path() email: string): Promise<CustomerResponse> {
    const customer = await customerService.getCustomerByEmail(email);

    if (!customer) {
      this.setStatus(404);
      throw new Error('Customer not found');
    }

    const locationCoords = customer.defaultLocation?.coordinates;

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      defaultAddress: customer.defaultAddress,
      defaultLocation: locationCoords
        ? {
            lat: locationCoords[1],
            lng: locationCoords[0],
          }
        : undefined,
      createdAt: customer.createdAt,
    };
  }

  /**
   * Update customer information
   *
   * @param id Customer ID
   * @param body Updated customer data
   * @returns Updated customer information
   */
  @Put('{id}')
  @Response<CustomerResponse>(200, 'Customer updated')
  @Response<{ error: string }>(404, 'Customer not found')
  @Response<{ error: string }>(409, 'Email or phone already registered')
  async updateCustomer(
    @Path() id: string,
    @Body() body: UpdateCustomerRequest
  ): Promise<CustomerResponse> {
    try {
      const customer = await customerService.updateCustomer(id, {
        name: body.name,
        email: body.email,
        phone: body.phone,
        defaultAddress: body.defaultAddress,
        defaultLocation: body.defaultLocation,
      });

      const locationCoords = customer.defaultLocation?.coordinates;

      return {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        defaultAddress: customer.defaultAddress,
        defaultLocation: locationCoords
          ? {
              lat: locationCoords[1],
              lng: locationCoords[0],
            }
          : undefined,
        createdAt: customer.createdAt,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        this.setStatus(404);
      } else if (
        error instanceof Error &&
        error.message.includes('already registered')
      ) {
        this.setStatus(409);
      }
      throw error;
    }
  }

  /**
   * Delete customer (admin only)
   *
   * @param id Customer ID
   * @returns Success message
   */
  @Delete('{id}')
  @Response<{ success: boolean; message: string }>(200, 'Customer deleted')
  @Response<{ error: string }>(400, 'Cannot delete customer with orders')
  @Response<{ error: string }>(404, 'Customer not found')
  async deleteCustomer(
    @Path() id: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await customerService.deleteCustomer(id);
      return {
        success: true,
        message: 'Customer deleted successfully',
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        this.setStatus(404);
      } else if (
        error instanceof Error &&
        error.message.includes('existing orders')
      ) {
        this.setStatus(400);
      }
      throw error;
    }
  }
}
