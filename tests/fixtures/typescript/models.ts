import type { Config } from './config';
import express, { Router } from 'express';

export interface User {
  id: string;
  name: string;
}

export type Result<T> = { ok: true; value: T };

export class UserService {
  private cache: Map<string, User> = new Map();

  constructor(private readonly config: Config) {}

  async find(id: string): Promise<User | null> {
    return this.cache.get(id) ?? null;
  }

  save(user: User): void {
    this.cache.set(user.id, user);
  }
}

export abstract class Repository<T> {
  abstract fetch(id: string): T | null;

  protected wrap(entity: T): T {
    return entity;
  }
}

export const createUser = (name: string): User => ({ id: '1', name });
