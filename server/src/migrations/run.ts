import { verifyDatabaseConnection } from '../config/database';
import { createAdvancedAuthTables } from '../models/AdvancedAuthMigration';
import { log, serializeError } from '../utils/logger';

async function runMigrations() {
  try {
    log('INFO', 'Starting migration run');
    await verifyDatabaseConnection();
    await createAdvancedAuthTables();
    log('INFO', 'Migration run completed successfully');
  } catch (error) {
    log('ERROR', 'Fatal migration error', serializeError(error));
    process.exit(1);
  }
}

void runMigrations();
