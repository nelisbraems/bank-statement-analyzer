import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { MongoClient, ObjectId } from 'mongodb';

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'bank_analyzer';
let db;

async function connectDB() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB');

  // Create unique compound index to prevent duplicate transactions
  await db.collection('transactions').createIndex(
    { date: 1, amount: 1, counterparty: 1, description: 1 },
    { unique: true, name: 'unique_transaction' }
  );

  // Create indexes for better query performance
  await db.collection('transactions').createIndex({ date: -1 });
  await db.collection('transactions').createIndex({ category: 1 });
  await db.collection('transactions').createIndex({ counterparty: 1 });
  await db.collection('transactions').createIndex({ amount: 1 });
}

// Import transactions (bulk insert, skips duplicates)
app.post('/api/transactions/import', async (req, res) => {
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
app.get('/api/transactions', async (req, res) => {
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
app.get('/api/transactions/aggregate', async (req, res) => {
  try {
    const { 
      groupBy = 'category',  // category, counterparty, type, month, year, day
      startDate,
      endDate,
      category,
      minAmount,
      maxAmount
    } = req.query;

    const matchStage = {};
    
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
app.get('/api/transactions/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const matchStage = {};
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
app.get('/api/transactions/distinct/:field', async (req, res) => {
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
app.delete('/api/transactions', async (req, res) => {
  try {
    const result = await db.collection('transactions').deleteMany({});
    res.json({ success: true, deletedCount: result.deletedCount });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update a transaction's category
app.patch('/api/transactions/:id', async (req, res) => {
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

const PORT = process.env.PORT || 3001;

connectDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(console.error);