import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'dist')));
}

// Authentication
const AUTH_PASSWORD = process.env.AUTH_PASSWORD;
const sessions = new Map(); // Simple in-memory session store

function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// Auth middleware - protects API routes
function requireAuth(req, res, next) {
  // Skip auth if no password is configured or in test mode
  if (!AUTH_PASSWORD || process.env.NODE_ENV === 'test') {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token || !sessions.has(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Login endpoint
app.post('/api/auth/login', (req, res) => {
  const { password } = req.body;

  if (!AUTH_PASSWORD) {
    // No password configured, auto-login
    const token = generateToken();
    sessions.set(token, { createdAt: Date.now() });
    return res.json({ success: true, token });
  }

  if (password === AUTH_PASSWORD) {
    const token = generateToken();
    sessions.set(token, { createdAt: Date.now() });
    res.json({ success: true, token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Check auth status
app.get('/api/auth/check', (req, res) => {
  if (!AUTH_PASSWORD) {
    return res.json({ authenticated: true, passwordRequired: false });
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token && sessions.has(token)) {
    res.json({ authenticated: true, passwordRequired: true });
  } else {
    res.json({ authenticated: false, passwordRequired: true });
  }
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    sessions.delete(token);
  }
  res.json({ success: true });
});

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.NODE_ENV === 'test' ? 'bank_analyzer_test' : 'bank_analyzer';
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB');

  // Create unique compound index to prevent duplicate transactions
  // Uses originalDescription (raw CSV data) for uniqueness - captures unique REFERTE numbers
  // Drop old index first if it exists with different fields
  try {
    await db.collection('transactions').dropIndex('unique_transaction');
  } catch (e) {
    // Index may not exist, ignore
  }
  await db.collection('transactions').createIndex(
    { date: 1, amount: 1, originalDescription: 1 },
    { unique: true, name: 'unique_transaction' }
  );

  // Create indexes for better query performance
  await db.collection('transactions').createIndex({ date: -1 });
  await db.collection('transactions').createIndex({ category: 1 });
  await db.collection('transactions').createIndex({ counterparty: 1 });
  await db.collection('transactions').createIndex({ amount: 1 });
}

// Import transactions (bulk insert, skips duplicates)
app.post('/api/transactions/import', requireAuth, async (req, res) => {
  try {
    const { transactions } = req.body;

    if (!transactions || !Array.isArray(transactions)) {
      return res.status(400).json({ error: 'Invalid transactions data' });
    }

    // Add metadata to each transaction
    const docs = transactions.map(t => ({
      ...t,
      importedAt: new Date(),
      dateObj: new Date(t.date), // Store as proper Date for querying
    }));

    // Use ordered: false to continue inserting even when duplicates are found
    let insertedCount = 0;
    let duplicateCount = 0;

    try {
      const result = await db.collection('transactions').insertMany(docs, { ordered: false });
      insertedCount = result.insertedCount;
    } catch (bulkError) {
      // MongoDB throws an error for duplicate key violations even with ordered: false
      // but it still inserts the non-duplicate documents
      if (bulkError.code === 11000) {
        // Extract counts from the bulk write error
        insertedCount = bulkError.result?.insertedCount || 0;
        duplicateCount = docs.length - insertedCount;
      } else {
        throw bulkError;
      }
    }

    res.json({
      success: true,
      insertedCount,
      duplicateCount,
      message: duplicateCount > 0
        ? `Imported ${insertedCount} new transactions, skipped ${duplicateCount} duplicates`
        : `Imported ${insertedCount} transactions`
    });
  } catch (error) {
    console.error('Import error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get all transactions with optional filters
app.get('/api/transactions', requireAuth, async (req, res) => {
  try {
    const { 
      category, 
      counterparty, 
      minAmount, 
      maxAmount,
      startDate,
      endDate,
      type,
      limit = 1000,
      skip = 0,
      sortBy = 'date',
      sortOrder = 'desc'
    } = req.query;

    const filter = {};
    
    if (category) filter.category = category;
    if (counterparty) filter.counterparty = { $regex: counterparty, $options: 'i' };
    if (type) filter.type = type;
    if (minAmount || maxAmount) {
      filter.amount = {};
      if (minAmount) filter.amount.$gte = parseFloat(minAmount);
      if (maxAmount) filter.amount.$lte = parseFloat(maxAmount);
    }
    if (startDate || endDate) {
      filter.dateObj = {};
      if (startDate) filter.dateObj.$gte = new Date(startDate);
      if (endDate) filter.dateObj.$lte = new Date(endDate);
    }

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const transactions = await db.collection('transactions')
      .find(filter)
      .sort(sort)
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .toArray();

    const total = await db.collection('transactions').countDocuments(filter);

    res.json({ transactions, total });
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Aggregate/Group transactions
app.get('/api/transactions/aggregate', requireAuth, async (req, res) => {
  try {
    const {
      groupBy = 'category',  // category, counterparty, type, month, year, day
      startDate,
      endDate,
      category,
      minAmount,
      maxAmount,
      excludeCreditCardPayments = 'true'  // Exclude lump-sum CC payments by default
    } = req.query;

    const matchStage = {};

    // Exclude credit card payments (lump sum from bank CSV) to avoid double-counting
    // when PDF details are also imported
    if (excludeCreditCardPayments === 'true') {
      matchStage.isCreditCardPayment = { $ne: true };
    }

    if (category) matchStage.category = category;
    if (minAmount || maxAmount) {
      matchStage.amount = {};
      if (minAmount) matchStage.amount.$gte = parseFloat(minAmount);
      if (maxAmount) matchStage.amount.$lte = parseFloat(maxAmount);
    }
    if (startDate || endDate) {
      matchStage.dateObj = {};
      if (startDate) matchStage.dateObj.$gte = new Date(startDate);
      if (endDate) matchStage.dateObj.$lte = new Date(endDate);
    }

    let groupId;
    switch (groupBy) {
      case 'month':
        groupId = { year: { $year: '$dateObj' }, month: { $month: '$dateObj' } };
        break;
      case 'year':
        groupId = { $year: '$dateObj' };
        break;
      case 'day':
        groupId = { $dateToString: { format: '%Y-%m-%d', date: '$dateObj' } };
        break;
      case 'counterparty':
        groupId = '$counterparty';
        break;
      case 'type':
        groupId = '$type';
        break;
      case 'category':
      default:
        groupId = '$category';
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: groupId,
          totalAmount: { $sum: '$amount' },
          count: { $sum: 1 },
          avgAmount: { $avg: '$amount' },
          minAmount: { $min: '$amount' },
          maxAmount: { $max: '$amount' },
          income: { 
            $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] }
          },
          expenses: { 
            $sum: { $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0] }
          }
        }
      },
      { $sort: { totalAmount: 1 } }
    ];

    const results = await db.collection('transactions').aggregate(pipeline).toArray();
    res.json({ groupBy, results });
  } catch (error) {
    console.error('Aggregate error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get summary statistics
app.get('/api/transactions/summary', requireAuth, async (req, res) => {
  try {
    const { startDate, endDate, excludeCreditCardPayments = 'true' } = req.query;

    const matchStage = {};

    // Exclude credit card payments (lump sum from bank CSV) to avoid double-counting
    if (excludeCreditCardPayments === 'true') {
      matchStage.isCreditCardPayment = { $ne: true };
    }

    if (startDate || endDate) {
      matchStage.dateObj = {};
      if (startDate) matchStage.dateObj.$gte = new Date(startDate);
      if (endDate) matchStage.dateObj.$lte = new Date(endDate);
    }

    const pipeline = [
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalIncome: {
            $sum: { $cond: [{ $gt: ['$amount', 0] }, '$amount', 0] }
          },
          totalExpenses: {
            $sum: { $cond: [{ $lt: ['$amount', 0] }, { $abs: '$amount' }, 0] }
          },
          transactionCount: { $sum: 1 },
          avgTransaction: { $avg: '$amount' }
        }
      }
    ];

    const result = await db.collection('transactions').aggregate(pipeline).toArray();
    const summary = result[0] || { 
      totalIncome: 0, 
      totalExpenses: 0, 
      transactionCount: 0,
      avgTransaction: 0
    };
    summary.netBalance = summary.totalIncome - summary.totalExpenses;

    res.json(summary);
  } catch (error) {
    console.error('Summary error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get distinct values for a field (for filter dropdowns)
app.get('/api/transactions/distinct/:field', requireAuth, async (req, res) => {
  try {
    const { field } = req.params;
    const allowedFields = ['category', 'counterparty', 'type', 'status'];
    
    if (!allowedFields.includes(field)) {
      return res.status(400).json({ error: 'Invalid field' });
    }

    const values = await db.collection('transactions').distinct(field);
    res.json({ field, values: values.filter(v => v) });
  } catch (error) {
    console.error('Distinct error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete all transactions
app.delete('/api/transactions', requireAuth, async (req, res) => {
  try {
    const result = await db.collection('transactions').deleteMany({});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a transaction's category
app.patch('/api/transactions/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const result = await db.collection('transactions').updateOne(
      { _id: new ObjectId(id) },
      { $set: updates }
    );
    
    res.json({ success: true, modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Parse Mastercard PDF statements
app.post('/api/transactions/parse-pdf', requireAuth, upload.array('files'), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No PDF files uploaded' });
    }

    const allTransactions = [];
    const errors = [];

    for (const file of req.files) {
      try {
        const data = await pdf(file.buffer);
        const text = data.text;

        // Extract year from "Periode van transacties" line (e.g., "Van 05/01/2025 tot 04/02/2025")
        const periodMatch = text.match(/Van\s+\d{2}\/\d{2}\/(\d{4})\s+tot/);
        const year = periodMatch ? periodMatch[1] : new Date().getFullYear().toString();

        // The PDF text has transactions in format:
        // "DD/MMDD/MMDescription\n€ [-]amount"
        // Where dates are stuck together and amount is on next line
        // Example: "06/0108/01PAYPAL  BASIC FIT 0911 35314369001 NL\n€ -54,97"

        const lines = text.split('\n');
        let inDetailSection = false;
        let pendingTransaction = null;

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Start of detail section
          if (trimmedLine.includes('Kaartnummer') && trimmedLine.includes('XXXX')) {
            inDetailSection = true;
            continue;
          }

          // Skip header lines
          if (trimmedLine.includes('Transacties van') ||
              (trimmedLine.includes('Datum') && trimmedLine.includes('transactie'))) {
            continue;
          }

          // End markers
          if (trimmedLine.includes('Subtotaal')) {
            // Process any pending transaction before breaking
            if (pendingTransaction) {
              allTransactions.push(pendingTransaction);
              pendingTransaction = null;
            }
            break;
          }

          if (!inDetailSection) continue;

          // Check if this is an amount line (starts with €)
          const amountMatch = trimmedLine.match(/^€\s*([+-]?[\d.,]+)$/);
          if (amountMatch && pendingTransaction) {
            // Parse amount (European format: 1.234,56 -> 1234.56)
            const amountStr = amountMatch[1];
            pendingTransaction.amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.'));
            allTransactions.push(pendingTransaction);
            pendingTransaction = null;
            continue;
          }

          // Check if this is a transaction line (starts with DD/MMDD/MM)
          const txnMatch = trimmedLine.match(/^(\d{2})\/(\d{2})(\d{2})\/(\d{2})(.+)$/);
          if (txnMatch) {
            // Save any pending transaction first
            if (pendingTransaction) {
              allTransactions.push(pendingTransaction);
            }

            const [, day, month, , , description] = txnMatch;
            const date = `${day}/${month}/${year}`;
            const cleanDescription = description.trim();
            const counterparty = extractMastercardCounterparty(cleanDescription);

            pendingTransaction = {
              date,
              amount: 0, // Will be filled from next line
              description: cleanDescription,
              counterparty,
              type: 'Mastercard',
              source: 'mastercard_pdf',
              category: categorizeTransaction(cleanDescription, -1) // Assume expense for categorization
            };
          }
        }

        // Don't forget any final pending transaction
        if (pendingTransaction) {
          allTransactions.push(pendingTransaction);
        }
      } catch (parseError) {
        errors.push({ file: file.originalname, error: parseError.message });
      }
    }

    res.json({
      success: true,
      transactions: allTransactions,
      transactionCount: allTransactions.length,
      fileCount: req.files.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('PDF parse error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Extract counterparty from Mastercard description
function extractMastercardCounterparty(description) {
  const desc = description.trim();

  // PAYPAL patterns - extract the actual merchant
  if (desc.startsWith('PAYPAL ')) {
    const merchant = desc.replace(/^PAYPAL\s+/, '').split(/\s+\d/)[0];
    const merchantMap = {
      'IBOOD': 'iBood',
      'ITUNESAPPST AP': 'Apple/iTunes',
      'AIRBNB': 'Airbnb',
      'DISNEYPLUS': 'Disney+',
    };
    for (const [key, value] of Object.entries(merchantMap)) {
      if (merchant.includes(key)) return value;
    }
    return merchant;
  }

  // Known merchants
  if (desc.includes('IKEA')) return 'IKEA';
  if (desc.includes('DPG Media')) return 'DPG Media';
  if (desc.includes('RING STANDARD')) return 'Ring';

  // Generic: take first part before location codes
  const parts = desc.split(/\s+(?:BE|NL|DE|FR|GB|IE|LU)$/);
  if (parts[0]) {
    return parts[0].replace(/\s+\d+$/, '').trim();
  }

  return desc;
}

// Categorize transaction based on description
function categorizeTransaction(description, amount) {
  const desc = description.toLowerCase();
  if (amount > 0) return 'Income';
  if (desc.includes('ikea') || desc.includes('furniture')) return 'Shopping';
  if (desc.includes('ibood')) return 'Shopping';
  if (desc.includes('itunes') || desc.includes('apple')) return 'Entertainment';
  if (desc.includes('disney') || desc.includes('netflix') || desc.includes('spotify')) return 'Entertainment';
  if (desc.includes('airbnb') || desc.includes('hotel') || desc.includes('booking')) return 'Travel';
  if (desc.includes('ring') && desc.includes('plan')) return 'Utilities';
  if (desc.includes('dpg media')) return 'Subscriptions';
  return 'Other';
}

// Health check endpoint - reports which database is being used
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    database: DB_NAME,
    environment: process.env.NODE_ENV || 'development'
  });
});

// Serve frontend for all non-API routes in production (SPA fallback)
if (process.env.NODE_ENV === 'production') {
  app.get('/{*splat}', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} (database: ${DB_NAME})`);
  });
}).catch(console.error);