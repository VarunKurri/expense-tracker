import { TransactionType } from './transaction.model';

export interface TransactionTemplate {
  id?: string;
  name: string;
  type: TransactionType;
  amount?: number;
  notes?: string;
  merchant?: string;
  accountId?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  createdAt: number;
  updatedAt: number;
  useCount?: number;
}
