import 'dotenv/config';
import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'bank_analyzer';

/**
 * Extract counterparty name from description for transactions without one
 */
function extractCounterparty(description, type) {
  if (!description) return null;

  const desc = description.trim();

  // Pattern: "[4 digits] [Name] [Location] -" (bakery/shop terminal format)
  const terminalMatch = desc.match(/^\d{4}\s+(.+?)\s+\w+\s+-$/);
  if (terminalMatch) {
    return terminalMatch[1].trim();
  }

  // Pattern: "[Name]: [reference]" (e.g., "Jaxx: 72288235")
  const colonMatch = desc.match(/^([A-Za-z][A-Za-z0-9\s&'-]+):\s*\d+/);
  if (colonMatch) {
    return colonMatch[1].trim();
  }

  // Pattern: "[7-char code] [Name]" (e.g., "75Q9GCO Pelsbarn", "75MC00I H M Online BE")
  const codeMatch = desc.match(/^[A-Z0-9]{7}\s+(.+?)(?:\s+(?:BE|NL|DE|FR))?$/i);
  if (codeMatch) {
    let name = codeMatch[1].trim();
    // Clean up common suffixes
    name = name.replace(/\s+B\.?V\.?$/i, '').trim();
    name = name.replace(/\s+-\s*balans-?$/i, '').trim();
    // Fix "H M" -> "H&M"
    if (name.match(/^H\s+M\b/i)) {
      name = name.replace(/^H\s+M\b/i, 'H&M');
    }
    return name;
  }

  // Pattern: "ACUPUNCTUUR[LOCATION]" - split camelcase-ish
  if (desc.match(/^ACUPUNCTUUR[A-Z]/i)) {
    const location = desc.replace(/^ACUPUNCTUUR/i, '');
    return `Acupunctuur ${location.charAt(0).toUpperCase() + location.slice(1).toLowerCase()}`;
  }

  // Pattern: "[code] Klarna"
  if (desc.match(/Klarna$/i)) {
    return 'Klarna';
  }

  // Pattern: "[code] SHEIN"
  if (desc.match(/SHEIN$/i)) {
    return 'Shein';
  }

  // Pattern: "Order: [number]" or "[code] Order [number]"
  if (desc.match(/Order[:\s]+\d+/i)) {
    // Can't determine merchant from order number alone
    return null;
  }

  // Pattern: "by Multisafepay" - payment processor, can't determine merchant
  if (desc.match(/by Multisafepay$/i)) {
    return null;
  }

  // Pattern: "MASTERCARD [num] [ref]" - credit card payment
  if (desc.match(/^MASTERCARD\s+\d+/i)) {
    return 'Mastercard Payment';
  }

  // Pattern: "[code] Checkout id: [hash]"
  if (desc.match(/Checkout id:/i)) {
    return null;
  }

  // Generic "Payment Description" placeholder
  if (desc === 'Payment Description') {
    return null;
  }

  // Pure numeric references - can't extract
  if (desc.match(/^\d+$/)) {
    return null;
  }

  // Random hash/code patterns - can't extract
  if (desc.match(/^[A-Z0-9]{7}\s+[a-zA-Z0-9]{20,}$/)) {
    return null;
  }

  return null;
}

/**
 * Determine if a transaction is a credit card payment (should be excluded from totals)
 */
function isCreditCardPayment(description, type) {
  if (type === 'Kredietkaartbetaling') return true;
  if (description && description.match(/^MASTERCARD\s+\d+/i)) return true;
  return false;
}

async function migrate() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db(DB_NAME);
    const collection = db.collection('transactions');

    // Find transactions without counterparty
    const noCounterparty = await collection.find({
      $or: [
        { counterparty: { $exists: false } },
        { counterparty: null },
        { counterparty: '' }
      ]
    }).toArray();

    console.log(`\nFound ${noCounterparty.length} transactions without counterparty\n`);

    let extracted = 0;
    let creditCardPayments = 0;
    let unresolved = [];

    for (const txn of noCounterparty) {
      const updates = {};

      // Try to extract counterparty
      const counterparty = extractCounterparty(txn.description, txn.type);
      if (counterparty) {
        updates.counterparty = counterparty;
        extracted++;
      }

      // Check if it's a credit card payment
      if (isCreditCardPayment(txn.description, txn.type)) {
        updates.isCreditCardPayment = true;
        updates.source = 'bank_statement';
        creditCardPayments++;
      }

      // Add source field if not present
      if (!txn.source) {
        updates.source = updates.source || 'bank_statement';
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await collection.updateOne(
          { _id: txn._id },
          { $set: updates }
        );
      }

      // Track unresolved
      if (!counterparty) {
        unresolved.push({
          date: txn.date,
          amount: txn.amount,
          type: txn.type,
          description: txn.description
        });
      }
    }

    console.log('=== Migration Results ===');
    console.log(`Extracted counterparty: ${extracted}`);
    console.log(`Marked as credit card payment: ${creditCardPayments}`);
    console.log(`Still unresolved: ${unresolved.length}`);

    if (unresolved.length > 0) {
      console.log('\n=== Unresolved Transactions ===');
      unresolved.forEach((t, i) => {
        console.log(`${i + 1}. ${t.date} | €${t.amount} | ${t.type}`);
        console.log(`   Description: ${t.description}`);
      });
    }

    // Also add source field to all existing transactions that don't have it
    const addedSource = await collection.updateMany(
      { source: { $exists: false } },
      { $set: { source: 'bank_statement' } }
    );
    console.log(`\nAdded 'source' field to ${addedSource.modifiedCount} transactions`);

  } finally {
    await client.close();
  }
}

migrate().catch(console.error);
