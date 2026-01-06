import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { MongoClient } from 'mongodb';
import 'dotenv/config';

const API_URL = 'http://localhost:3001/api';
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const TEST_DB_NAME = 'bank_analyzer_test';

let client;
let db;

// Sample transaction data
const sampleTransaction = {
  date: '2024-01-15',
  amount: -45.50,
  description: 'Test transaction',
  counterparty: 'Test Store',
  category: 'Groceries',
  type: 'Betaling'
};

const sampleTransaction2 = {
  date: '2024-01-16',
  amount: -25.00,
  description: 'Another transaction',
  counterparty: 'Coffee Shop',
  category: 'Dining',
  type: 'Betaling'
};

describe('Transaction Import API', () => {
  beforeAll(async () => {
    // Check that the server is running in test mode
    const healthRes = await fetch(`${API_URL}/health`);
    if (!healthRes.ok) {
      throw new Error('Server is not running. Start it with: npm run server:test');
    }
    const health = await healthRes.json();
    if (health.database !== TEST_DB_NAME) {
      throw new Error(
        `SAFETY CHECK FAILED: Server is using "${health.database}" database, not "${TEST_DB_NAME}". ` +
        `Stop the server and restart with: npm run server:test`
      );
    }
    console.log(`Server verified: using test database (${health.database})`);

    // Connect to MongoDB directly for setup/teardown
    client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db(TEST_DB_NAME);
  });

  afterAll(async () => {
    // Clean up all test data after tests complete
    await db.collection('transactions').deleteMany({});
    console.log(`Test cleanup: removed all transactions from test database (${TEST_DB_NAME})`);
    await client.close();
  });

  beforeEach(async () => {
    // Clear transactions before each test
    await db.collection('transactions').deleteMany({});
  });

  describe('POST /api/transactions/import', () => {
    it('should import new transactions successfully', async () => {
      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction, sampleTransaction2] })
      });

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.insertedCount).toBe(2);
      expect(data.duplicateCount).toBe(0);
    });

    it('should skip duplicate transactions', async () => {
      // First import
      await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction] })
      });

      // Second import with same transaction
      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction] })
      });

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.insertedCount).toBe(0);
      expect(data.duplicateCount).toBe(1);
      expect(data.message).toContain('skipped');
    });

    it('should import new transactions and skip duplicates in same request', async () => {
      // First import one transaction
      await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction] })
      });

      // Second import with one duplicate and one new
      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction, sampleTransaction2] })
      });

      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.success).toBe(true);
      expect(data.insertedCount).toBe(1);
      expect(data.duplicateCount).toBe(1);
    });

    it('should handle re-importing entire file without creating duplicates', async () => {
      const transactions = [sampleTransaction, sampleTransaction2];

      // First import
      await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions })
      });

      // Re-import same file
      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions })
      });

      const data = await response.json();

      expect(data.insertedCount).toBe(0);
      expect(data.duplicateCount).toBe(2);

      // Verify total count in DB
      const count = await db.collection('transactions').countDocuments({});
      expect(count).toBe(2);
    });

    it('should treat transactions with different amounts as unique', async () => {
      const txn1 = { ...sampleTransaction, amount: -45.50 };
      const txn2 = { ...sampleTransaction, amount: -50.00 }; // Different amount

      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [txn1, txn2] })
      });

      const data = await response.json();

      expect(data.insertedCount).toBe(2);
      expect(data.duplicateCount).toBe(0);
    });

    it('should treat transactions with different dates as unique', async () => {
      const txn1 = { ...sampleTransaction, date: '2024-01-15' };
      const txn2 = { ...sampleTransaction, date: '2024-01-16' }; // Different date

      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [txn1, txn2] })
      });

      const data = await response.json();

      expect(data.insertedCount).toBe(2);
      expect(data.duplicateCount).toBe(0);
    });

    it('should return error for invalid data', async () => {
      const response = await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: 'not an array' })
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });
  });

  describe('GET /api/transactions', () => {
    it('should return imported transactions', async () => {
      // Import some transactions
      await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction, sampleTransaction2] })
      });

      const response = await fetch(`${API_URL}/transactions`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.transactions).toHaveLength(2);
      expect(data.total).toBe(2);
    });
  });

  describe('GET /api/transactions/summary', () => {
    it('should return correct summary after import', async () => {
      const incomeTransaction = {
        date: '2024-01-17',
        amount: 1000,
        description: 'Salary',
        counterparty: 'Employer',
        category: 'Income',
        type: 'Overschrijving'
      };

      await fetch(`${API_URL}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transactions: [sampleTransaction, incomeTransaction] })
      });

      const response = await fetch(`${API_URL}/transactions/summary`);
      const data = await response.json();

      expect(response.ok).toBe(true);
      expect(data.totalIncome).toBe(1000);
      expect(data.totalExpenses).toBe(45.50);
      expect(data.transactionCount).toBe(2);
      expect(data.netBalance).toBe(954.50);
    });
  });
});
