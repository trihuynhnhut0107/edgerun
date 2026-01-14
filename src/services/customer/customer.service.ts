import { AppDataSource } from '../../config/ormconfig';
import { Customer } from '../../entities/Customer';

export interface CreateCustomerDTO {
  name: string;
  email: string;
  phone: string;
  defaultAddress?: string;
  defaultLocation?: {
    lat: number;
    lng: number;
  };
}

export interface UpdateCustomerDTO {
  name?: string;
  email?: string;
  phone?: string;
  defaultAddress?: string;
  defaultLocation?: {
    lat: number;
    lng: number;
  };
}

export class CustomerService {
  private customerRepo = AppDataSource.getRepository(Customer);

  /**
   * Create a new customer (registration)
   */
  async createCustomer(data: CreateCustomerDTO): Promise<Customer> {
    // Check if email already exists
    const existingEmail = await this.customerRepo.findOne({
      where: { email: data.email },
    });
    if (existingEmail) {
      throw new Error('Email already registered');
    }

    // Check if phone already exists
    const existingPhone = await this.customerRepo.findOne({
      where: { phone: data.phone },
    });
    if (existingPhone) {
      throw new Error('Phone number already registered');
    }

    const customer = this.customerRepo.create({
      name: data.name,
      email: data.email,
      phone: data.phone,
      defaultAddress: data.defaultAddress,
      defaultLocation: data.defaultLocation
        ? {
            type: 'Point',
            coordinates: [data.defaultLocation.lng, data.defaultLocation.lat],
          }
        : undefined,
    });

    return await this.customerRepo.save(customer);
  }

  /**
   * Get customer by ID
   */
  async getCustomer(id: string): Promise<Customer | null> {
    return await this.customerRepo.findOne({
      where: { id },
      relations: ['orders'],
    });
  }

  /**
   * Get customer by email
   */
  async getCustomerByEmail(email: string): Promise<Customer | null> {
    return await this.customerRepo.findOne({
      where: { email },
    });
  }

  /**
   * Get customer by phone
   */
  async getCustomerByPhone(phone: string): Promise<Customer | null> {
    return await this.customerRepo.findOne({
      where: { phone },
    });
  }

  /**
   * Update customer details
   */
  async updateCustomer(
    id: string,
    data: UpdateCustomerDTO
  ): Promise<Customer> {
    const customer = await this.customerRepo.findOne({ where: { id } });
    if (!customer) {
      throw new Error('Customer not found');
    }

    // Check for email uniqueness if updating email
    if (data.email && data.email !== customer.email) {
      const existingEmail = await this.customerRepo.findOne({
        where: { email: data.email },
      });
      if (existingEmail) {
        throw new Error('Email already registered');
      }
    }

    // Check for phone uniqueness if updating phone
    if (data.phone && data.phone !== customer.phone) {
      const existingPhone = await this.customerRepo.findOne({
        where: { phone: data.phone },
      });
      if (existingPhone) {
        throw new Error('Phone number already registered');
      }
    }

    const updateData: Partial<Customer> = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.email !== undefined) updateData.email = data.email;
    if (data.phone !== undefined) updateData.phone = data.phone;
    if (data.defaultAddress !== undefined)
      updateData.defaultAddress = data.defaultAddress;
    if (data.defaultLocation !== undefined) {
      updateData.defaultLocation = {
        type: 'Point',
        coordinates: [data.defaultLocation.lng, data.defaultLocation.lat],
      };
    }

    await this.customerRepo.update({ id }, updateData);

    const updated = await this.customerRepo.findOne({ where: { id } });
    return updated!;
  }

  /**
   * Get all customers (admin)
   */
  async getAllCustomers(limit: number = 100): Promise<Customer[]> {
    return await this.customerRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Delete customer (admin)
   */
  async deleteCustomer(id: string): Promise<boolean> {
    const customer = await this.customerRepo.findOne({
      where: { id },
      relations: ['orders'],
    });

    if (!customer) {
      throw new Error('Customer not found');
    }

    if (customer.orders && customer.orders.length > 0) {
      throw new Error('Cannot delete customer with existing orders');
    }

    const result = await this.customerRepo.delete(id);
    return result.affected ? result.affected > 0 : false;
  }
}

export const customerService = new CustomerService();
